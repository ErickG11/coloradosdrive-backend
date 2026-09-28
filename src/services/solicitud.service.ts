import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import {
  EDAD_EXENCION_PAPELETA,
  TIPOS_DOCUMENTO,
  type ChecklistItem,
  type CompletarDatosResult,
  type ConfirmarCodigoResult,
  type DecidirSolicitudInput,
  type SolicitudAdminView,
  type SolicitudRelacionada,
  type SolicitudDatosInput,
  type SolicitudDocumentoResult,
  type SolicitudEstado,
  type SolicitudTipoDocumento,
  type UploadedFile,
} from '../models/solicitud.model';
import { AppError } from '../utils/AppError';
import { detectFileType } from '../utils/fileSignature';
import { signSolicitudToken } from '../utils/solicitudToken';
import type { AccountService } from './account.service';
import { isCupoExceededError, type CohortAssignmentService } from './cohortAssignment.service';
import type { EmailService } from './email.service';

type SolicitudRow = Database['public']['Tables']['solicitudes_inscripcion']['Row'];
type DocumentoRow = Database['public']['Tables']['solicitud_documentos']['Row'];

// Tope de reintentos ante una condición de carrera real por el último
// cupo de una cohorte (ver enforce_cohort_cupo, migración 014): cada
// intento excluye la cohorte que acaba de llenarse y vuelve a pedir
// candidatas frescas. Es un caso rarísimo (dos aprobaciones exactamente
// simultáneas para el mismo curso); el tope solo evita un loop patológico
// si algo más estuviera mal.
const MAX_INTENTOS_ASIGNACION_COHORTE = 5;

export const SOLICITUDES_BUCKET = 'solicitudes-documentos';
export const CODE_TTL_MINUTES = 15;
export const MAX_CODE_ATTEMPTS = 5;
const SIGNED_URL_SECONDS = 300;
const POSTGRES_UNIQUE_VIOLATION = '23505';

const EXTENSION_BY_DETECTED_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};
// Filtro barato en Multer, ANTES de bufferizar el archivo completo (ver
// middlewares/upload.ts): usa el Content-Type que declara el cliente,
// que es falsificable. Es solo para rechazar temprano lo obviamente no
// permitido; la decisión de seguridad real es detectFileType() sobre el
// contenido ya bufferizado, más abajo en subirDocumento().
export const ALLOWED_MIMETYPES = Object.keys(EXTENSION_BY_DETECTED_TYPE);

function normalizeCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function isUniqueViolation(error: PostgrestError | null): boolean {
  return error?.code === POSTGRES_UNIQUE_VIOLATION;
}

// Años cumplidos a `now` a partir de una fecha 'YYYY-MM-DD'.
export function calcularEdad(fechaNacimiento: string, now: Date = new Date()): number {
  const [year, month, day] = fechaNacimiento.split('-').map(Number);
  let age = now.getUTCFullYear() - year;
  const birthdayPassed =
    now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  if (!birthdayPassed) {
    age -= 1;
  }
  return age;
}

function toAdminView(
  row: SolicitudRow,
  documentos: ChecklistItem[],
  solicitudesRelacionadas: SolicitudRelacionada[],
): SolicitudAdminView {
  return {
    id: row.id,
    courseId: row.course_id,
    cedula: row.cedula,
    nombreCompleto: row.nombre_completo,
    telefono: row.telefono,
    correo: row.correo,
    fechaNacimiento: row.fecha_nacimiento,
    correoVerificado: row.correo_verificado,
    estado: row.estado,
    motivoRechazo: row.motivo_rechazo,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    studentId: row.student_id,
    createdAt: row.created_at,
    documentos,
    solicitudesRelacionadas,
  };
}

export interface DecidirSolicitudResult {
  id: string;
  estado: SolicitudEstado;
  studentId: string | null;
  // Solo para 'aprobada': false si la cuenta se creó pero el correo con la
  // clave temporal falló (queda registrado en logs para reintento manual).
  correoEnviado: boolean | null;
}

// Recibe el cliente de Supabase y los servicios por constructor para poder
// mockearlos en tests.
export class SolicitudService {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly emailService: EmailService,
    private readonly accountService: AccountService,
    private readonly cohortAssignmentService: CohortAssignmentService,
  ) {}

  // ---------------------------------------------------------------------
  // Verificación de correo
  // ---------------------------------------------------------------------
  async verificarCorreo(correoInput: string, courseId: string): Promise<void> {
    const correo = correoInput.trim().toLowerCase();
    const existing = await this.findByCorreo(correo);

    if (existing?.estado === 'aprobada') {
      throw new AppError('Ya existe una solicitud aprobada para este correo', 409);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeFields = {
      // El curso se guarda/actualiza aquí también en un reintento: si el
      // postulante vuelve a pedir código para otro curso, esta solicitud
      // en progreso refleja su elección más reciente.
      course_id: courseId,
      codigo_verificacion: hashCode(code),
      codigo_expira_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
      // Un código nuevo reinicia el contador: los intentos fallidos contra
      // el código ANTERIOR ya no aplican a este.
      intentos_codigo: 0,
    };

    if (existing) {
      const { error } = await this.supabase
        .from('solicitudes_inscripcion')
        .update(codeFields)
        .eq('id', existing.id);
      if (error) {
        throw error;
      }
    } else {
      const { error } = await this.supabase
        .from('solicitudes_inscripcion')
        .insert({ correo, ...codeFields });
      if (error) {
        throw error;
      }
    }

    try {
      await this.emailService.sendVerificationCodeEmail({
        to: correo,
        code,
        expiresInMinutes: CODE_TTL_MINUTES,
      });
    } catch (err) {
      console.error('No se pudo enviar el código de verificación:', err);
      throw new AppError('No se pudo enviar el código de verificación. Intenta de nuevo', 502);
    }
  }

  async confirmarCodigo(correoInput: string, codigo: string): Promise<ConfirmarCodigoResult> {
    const correo = correoInput.trim().toLowerCase();
    const row = await this.findByCorreo(correo);

    // Mismo mensaje para "no existe", "sin código", "vencido" y "no
    // coincide": no se revela cuál de los casos fue.
    const invalid = new AppError('Código inválido o vencido', 400);
    if (!row?.codigo_verificacion || !row.codigo_expira_at) {
      throw invalid;
    }
    if (new Date(row.codigo_expira_at).getTime() <= Date.now()) {
      throw invalid;
    }

    const expected = Buffer.from(row.codigo_verificacion, 'hex');
    const received = Buffer.from(hashCode(codigo), 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      const attempts = row.intentos_codigo + 1;
      // Al llegar al máximo, se invalida el código ya mismo (no solo se
      // cuenta): un intento #6 con el código correcto tampoco debe pasar,
      // así que limpiarlo aquí es lo que realmente lo hace cumplir.
      const lockedOut = attempts >= MAX_CODE_ATTEMPTS;
      const { error: attemptError } = await this.supabase
        .from('solicitudes_inscripcion')
        .update(
          lockedOut
            ? { intentos_codigo: attempts, codigo_verificacion: null, codigo_expira_at: null }
            : { intentos_codigo: attempts },
        )
        .eq('id', row.id);
      if (attemptError) {
        throw attemptError;
      }
      throw lockedOut
        ? new AppError('Demasiados intentos fallidos. Solicita un nuevo código', 429)
        : invalid;
    }

    const { error } = await this.supabase
      .from('solicitudes_inscripcion')
      .update({
        correo_verificado: true,
        codigo_verificacion: null,
        codigo_expira_at: null,
        intentos_codigo: 0,
      })
      .eq('id', row.id);
    if (error) {
      throw error;
    }

    return { solicitudId: row.id, token: signSolicitudToken(row.id) };
  }

  // ---------------------------------------------------------------------
  // Datos personales (cédula, nombre, fecha de nacimiento)
  // ---------------------------------------------------------------------
  async completarDatos(
    solicitudId: string,
    input: SolicitudDatosInput,
  ): Promise<CompletarDatosResult> {
    const current = await this.getOrThrow(solicitudId);

    if (!current.correo_verificado) {
      throw new AppError('Debes verificar tu correo antes de continuar', 403);
    }
    if (current.estado === 'aprobada') {
      throw new AppError('Esta solicitud ya fue aprobada', 409);
    }

    const { data: conflicts, error: conflictError } = await this.supabase
      .from('solicitudes_inscripcion')
      .select()
      .eq('cedula', input.cedula)
      .neq('id', solicitudId);
    if (conflictError) {
      throw conflictError;
    }

    if (conflicts.some((c) => c.estado === 'pendiente_revision' || c.estado === 'aprobada')) {
      throw new AppError('Ya existe una solicitud activa para esta cédula', 409);
    }

    const datos = {
      cedula: input.cedula,
      nombre_completo: input.nombreCompleto,
      telefono: input.telefono ?? null,
      fecha_nacimiento: input.fechaNacimiento,
    };
    // Vuelve a "recién enviada": sin esto la limpieza por antigüedad
    // borraría de inmediato un registro rechazado viejo reutilizado.
    const resetFields = {
      estado: 'pendiente_revision' as const,
      motivo_rechazo: null,
      reviewed_by: null,
      reviewed_at: null,
      student_id: null,
      created_at: new Date().toISOString(),
    };

    // Solo es un "reintento de la misma persona" si el correo de la fila
    // rechazada coincide con el de quien está completando datos ahora. Sin
    // esto, cualquiera que conozca la cédula de otra persona (no es un dato
    // secreto) podría verificar SU PROPIO correo y luego reclamar/borrar el
    // registro rechazado de alguien más con solo enviar esa cédula — ver el
    // hallazgo de suplantación reportado. Si el correo no coincide, esta
    // cédula simplemente puede tener dos filas independientes (el índice
    // parcial de 007_solicitudes_inscripcion.sql solo bloquea duplicados en
    // pendiente_revision/aprobada, nunca en rechazada), así que se deja que
    // la solicitud actual siga su curso normal como una nueva e
    // independiente, sin tocar la rechazada de nadie más.
    const rejectedForCedula = conflicts.find(
      (c) =>
        c.estado === 'rechazada' && normalizeCorreo(c.correo) === normalizeCorreo(current.correo),
    );

    // Reintento de una cédula rechazada anteriormente por la MISMA persona
    // (mismo correo): se reemplaza ESE registro (mismo id), no se crea uno
    // nuevo.
    if (rejectedForCedula) {
      await this.borrarDocumentos(rejectedForCedula.id);
      await this.borrarDocumentos(current.id);
      const { error: deleteError } = await this.supabase
        .from('solicitudes_inscripcion')
        .delete()
        .eq('id', current.id);
      if (deleteError) {
        throw deleteError;
      }

      const { error } = await this.supabase
        .from('solicitudes_inscripcion')
        .update({
          ...datos,
          ...resetFields,
          correo: current.correo,
          correo_verificado: true,
          codigo_verificacion: null,
          codigo_expira_at: null,
        })
        .eq('id', rejectedForCedula.id);
      if (error) {
        throw isUniqueViolation(error)
          ? new AppError('Ya existe una solicitud activa para esta cédula', 409)
          : error;
      }

      return {
        solicitudId: rejectedForCedula.id,
        token: signSolicitudToken(rejectedForCedula.id),
      };
    }

    // El propio registro estaba rechazado: se reutiliza en el mismo id.
    if (current.estado === 'rechazada') {
      await this.borrarDocumentos(current.id);
    }

    const { error } = await this.supabase
      .from('solicitudes_inscripcion')
      .update(current.estado === 'rechazada' ? { ...datos, ...resetFields } : datos)
      .eq('id', current.id);
    if (error) {
      throw isUniqueViolation(error)
        ? new AppError('Ya existe una solicitud activa para esta cédula', 409)
        : error;
    }

    return { solicitudId: current.id, token: signSolicitudToken(current.id) };
  }

  // ---------------------------------------------------------------------
  // Documentos
  // ---------------------------------------------------------------------
  async subirDocumento(
    solicitudId: string,
    tipoDocumento: SolicitudTipoDocumento,
    file: UploadedFile,
  ): Promise<SolicitudDocumentoResult> {
    const solicitud = await this.getOrThrow(solicitudId);

    if (solicitud.estado !== 'pendiente_revision') {
      throw new AppError('Esta solicitud ya no admite documentos', 409);
    }
    if (!solicitud.cedula) {
      throw new AppError('Completa tus datos (cédula) antes de subir documentos', 409);
    }

    // El Content-Type que declara el cliente es falsificable (basta con
    // cambiar la extensión al subir); para documentos de identidad se
    // verifica el contenido real por su firma binaria, no lo que dice el
    // multipart. `file.mimetype` ya no se usa para decidir nada de acá en
    // adelante.
    const detectedType = detectFileType(file.buffer);
    if (!detectedType) {
      throw new AppError('Tipo de archivo no permitido (solo JPG, PNG o PDF)', 400);
    }
    const extension = EXTENSION_BY_DETECTED_TYPE[detectedType];

    const { data: existing, error: existingError } = await this.supabase
      .from('solicitud_documentos')
      .select()
      .eq('solicitud_id', solicitudId)
      .eq('tipo_documento', tipoDocumento)
      .maybeSingle();
    if (existingError) {
      throw existingError;
    }
    if (existing?.estado === 'aprobado') {
      throw new AppError('Este documento ya fue aprobado y no se puede reemplazar', 409);
    }

    const storagePath = `${solicitudId}/${tipoDocumento}-${randomUUID()}.${extension}`;
    const bucket = this.supabase.storage.from(SOLICITUDES_BUCKET);

    const { error: uploadError } = await bucket.upload(storagePath, file.buffer, {
      contentType: detectedType,
      upsert: false,
    });
    if (uploadError) {
      throw new AppError('No se pudo guardar el documento. Intenta de nuevo', 502);
    }

    const now = new Date().toISOString();
    const { data, error } = existing
      ? await this.supabase
          .from('solicitud_documentos')
          .update({
            storage_path: storagePath,
            estado: 'recibido',
            motivo_rechazo: null,
            uploaded_at: now,
            reviewed_at: null,
          })
          .eq('id', existing.id)
          .select()
          .single()
      : await this.supabase
          .from('solicitud_documentos')
          .insert({
            solicitud_id: solicitudId,
            tipo_documento: tipoDocumento,
            storage_path: storagePath,
          })
          .select()
          .single();

    if (error) {
      // Compensación: no dejar un objeto huérfano en Storage.
      await bucket.remove([storagePath]).catch(() => undefined);
      throw error;
    }

    if (existing) {
      await bucket.remove([existing.storage_path]).catch(() => undefined);
    }

    return {
      id: data.id,
      tipoDocumento: data.tipo_documento,
      estado: data.estado,
      uploadedAt: data.uploaded_at,
    };
  }

  // ---------------------------------------------------------------------
  // Panel del admin
  // ---------------------------------------------------------------------
  async listarParaAdmin(estado?: SolicitudEstado): Promise<SolicitudAdminView[]> {
    // Las filas que solo verificaron el correo (sin cédula) son solicitudes
    // en progreso: todavía no hay nada que revisar.
    let query = this.supabase
      .from('solicitudes_inscripcion')
      .select()
      .not('cedula', 'is', null)
      .order('created_at');
    if (estado) {
      query = query.eq('estado', estado);
    }
    const { data: solicitudes, error } = await query;
    if (error) {
      throw error;
    }
    if (solicitudes.length === 0) {
      return [];
    }

    const { data: documentos, error: docsError } = await this.supabase
      .from('solicitud_documentos')
      .select()
      .in(
        'solicitud_id',
        solicitudes.map((s) => s.id),
      );
    if (docsError) {
      throw docsError;
    }

    const urlByPath = await this.signPaths(documentos.map((d) => d.storage_path));
    const relatedByCedula = await this.findRelatedByCedula(solicitudes);

    return solicitudes.map((solicitud) =>
      toAdminView(
        solicitud,
        this.buildChecklist(
          solicitud,
          documentos.filter((d) => d.solicitud_id === solicitud.id),
          urlByPath,
        ),
        (relatedByCedula.get(solicitud.cedula) ?? []).filter((r) => r.id !== solicitud.id),
      ),
    );
  }

  // Cualquier OTRA solicitud (de cualquier estado) que comparta cédula con
  // alguna de las que se están mostrando — solo contexto de lectura para el
  // admin (ver hallazgo de suplantación en completarDatos), el sistema
  // nunca decide nada a partir de esto.
  private async findRelatedByCedula(
    solicitudes: Pick<SolicitudRow, 'cedula'>[],
  ): Promise<Map<string, SolicitudRelacionada[]>> {
    const cedulas = [
      ...new Set(solicitudes.map((s) => s.cedula).filter((c): c is string => c !== null)),
    ];
    if (cedulas.length === 0) {
      return new Map();
    }

    const { data, error } = await this.supabase
      .from('solicitudes_inscripcion')
      .select('id, cedula, correo, estado, created_at')
      .in('cedula', cedulas);
    if (error) {
      throw error;
    }

    const byCedula = new Map<string, SolicitudRelacionada[]>();
    for (const row of data) {
      // La query solo puede devolver filas cuya cédula está en `cedulas`
      // (todas ya filtradas como no-null), así que esta rama es inalcanzable
      // en la práctica — se descarta explícitamente en vez de forzar el
      // tipo, para que TS siga verificando el resto sin asertar nada.
      if (row.cedula === null) {
        continue;
      }
      const list = byCedula.get(row.cedula) ?? [];
      list.push({ id: row.id, correo: row.correo, estado: row.estado, createdAt: row.created_at });
      byCedula.set(row.cedula, list);
    }
    return byCedula;
  }

  async revisarDocumento(
    solicitudId: string,
    documentoId: string,
    input: { estado: 'aprobado' | 'rechazado'; motivoRechazo?: string },
  ): Promise<{ id: string; estado: 'aprobado' | 'rechazado' }> {
    const solicitud = await this.getOrThrow(solicitudId);
    if (solicitud.estado !== 'pendiente_revision') {
      throw new AppError('La solicitud ya fue resuelta', 409);
    }

    const { data, error } = await this.supabase
      .from('solicitud_documentos')
      .update({
        estado: input.estado,
        motivo_rechazo: input.estado === 'rechazado' ? (input.motivoRechazo ?? null) : null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', documentoId)
      .eq('solicitud_id', solicitudId)
      .select()
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('El documento indicado no existe en esta solicitud', 404);
    }

    return { id: data.id, estado: input.estado };
  }

  async decidir(
    solicitudId: string,
    adminId: string,
    input: DecidirSolicitudInput,
  ): Promise<DecidirSolicitudResult> {
    const solicitud = await this.getOrThrow(solicitudId);
    if (solicitud.estado !== 'pendiente_revision') {
      throw new AppError('La solicitud ya fue resuelta', 409);
    }

    const reviewedAt = new Date().toISOString();

    if (input.estado === 'rechazada') {
      const { data, error } = await this.supabase
        .from('solicitudes_inscripcion')
        .update({
          estado: 'rechazada',
          motivo_rechazo: input.motivoRechazo ?? null,
          reviewed_by: adminId,
          reviewed_at: reviewedAt,
        })
        .eq('id', solicitudId)
        .eq('estado', 'pendiente_revision')
        .select()
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        throw new AppError('La solicitud ya fue resuelta', 409);
      }
      return { id: solicitudId, estado: 'rechazada', studentId: null, correoEnviado: null };
    }

    if (!solicitud.cedula || !solicitud.nombre_completo || !solicitud.correo_verificado) {
      throw new AppError('La solicitud no tiene los datos completos para aprobarse', 409);
    }

    // Aprobación: el admin decide con total discreción (documentos
    // pendientes o rechazados no bloquean). No es una transacción real —
    // Supabase Auth vive fuera de Postgres — así que si algo falla después
    // de crear la cuenta, se compensa borrándola (ver docs/adr/002).
    const { userId, temporaryPassword } = await this.accountService.crearCuentaConClaveTemporal(
      solicitud.correo,
    );

    try {
      const { error: userError } = await this.supabase.from('users').insert({
        id: userId,
        cedula: solicitud.cedula,
        nombre_completo: solicitud.nombre_completo,
        telefono: solicitud.telefono,
        rol: 'estudiante',
        status: 'verificado',
        debe_cambiar_password: true,
      });
      if (userError) {
        throw isUniqueViolation(userError)
          ? new AppError('Ya existe un usuario registrado con esta cédula', 409)
          : userError;
      }

      // Asigna automáticamente una cohorte del curso al que aplicó (o deja
      // la inscripción pendiente de cohorte si ninguna tiene matrícula
      // abierta hoy) — ver CohortAssignmentService.
      await this.crearEnrollmentConAsignacion(userId, solicitud.course_id);

      const { data, error } = await this.supabase
        .from('solicitudes_inscripcion')
        .update({
          estado: 'aprobada',
          student_id: userId,
          reviewed_by: adminId,
          reviewed_at: reviewedAt,
          motivo_rechazo: null,
        })
        .eq('id', solicitudId)
        .eq('estado', 'pendiente_revision')
        .select()
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        throw new AppError('La solicitud ya fue resuelta', 409);
      }
    } catch (err) {
      // Si ya se alcanzó a crear el enrollment, hay que borrarlo primero:
      // enrollments.student_id referencia a users con ON DELETE RESTRICT,
      // así que si queda una fila viva, el borrado de la cuenta de Auth
      // (que arrastra su fila en `users` vía ON DELETE CASCADE) fallaría
      // en silencio y dejaría una cuenta + inscripción huérfanas pese a
      // que la aprobación no se completó.
      await this.eliminarEnrollmentDeEstudiante(userId);
      await this.accountService.eliminarCuenta(userId);
      throw err;
    }

    // Un fallo de correo NO revierte la cuenta ya creada: se registra para
    // reintento manual.
    let correoEnviado = true;
    try {
      await this.emailService.sendApplicationApprovedEmail({
        to: solicitud.correo,
        nombreCompleto: solicitud.nombre_completo,
        temporaryPassword,
      });
    } catch (err) {
      correoEnviado = false;
      console.error(
        `No se pudo enviar el correo de aprobación (solicitud ${solicitudId}, estudiante ${userId}); reintentar manualmente:`,
        err,
      );
    }

    return { id: solicitudId, estado: 'aprobada', studentId: userId, correoEnviado };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  // Asigna automáticamente una cohorte del curso indicado y crea el
  // enrollment correspondiente. Si assignCohort no encuentra ninguna
  // cohorte elegible, crea la inscripción como 'pendiente_cohorte' (sin
  // cohortId ni montoTotal) — el admin la asignará manualmente después.
  //
  // Si la cohorte elegida se llenó por una condición de carrera real
  // justo entre que se contó el cupo y este INSERT (ver
  // enforce_cohort_cupo, migración 014), reintenta la asignación
  // excluyendo esa cohorte, con candidatas y conteos frescos.
  private async crearEnrollmentConAsignacion(studentId: string, courseId: string): Promise<void> {
    const excluidas: string[] = [];

    for (let intento = 0; intento < MAX_INTENTOS_ASIGNACION_COHORTE; intento++) {
      const asignacion = await this.cohortAssignmentService.assignCohortForCourse(
        courseId,
        undefined,
        excluidas,
      );

      if (asignacion.cohortId === null) {
        await this.insertEnrollmentRow({
          student_id: studentId,
          cohort_id: null,
          status: 'pendiente_cohorte',
          monto_total: null,
        });
        return;
      }

      try {
        await this.insertEnrollmentRow({
          student_id: studentId,
          cohort_id: asignacion.cohortId,
          status: 'activo',
          monto_total: asignacion.precio,
        });
        return;
      } catch (err) {
        if (isCupoExceededError(err)) {
          excluidas.push(asignacion.cohortId);
          continue;
        }
        throw err;
      }
    }

    // Se agotaron los reintentos (prácticamente imposible en la práctica):
    // cae a pendiente de cohorte en vez de fallar la aprobación completa.
    await this.insertEnrollmentRow({
      student_id: studentId,
      cohort_id: null,
      status: 'pendiente_cohorte',
      monto_total: null,
    });
  }

  private async insertEnrollmentRow(
    row: Database['public']['Tables']['enrollments']['Insert'],
  ): Promise<void> {
    const { error } = await this.supabase.from('enrollments').insert(row);
    if (error) {
      throw error;
    }
  }

  // Compensación best-effort (igual que AccountService.eliminarCuenta):
  // si falla, solo se registra, nunca enmascara el error original que
  // disparó el rollback.
  private async eliminarEnrollmentDeEstudiante(studentId: string): Promise<void> {
    const { error } = await this.supabase.from('enrollments').delete().eq('student_id', studentId);
    if (error) {
      console.error(
        `No se pudo borrar el enrollment huérfano del estudiante ${studentId} durante el rollback:`,
        error,
      );
    }
  }

  private async findByCorreo(correo: string): Promise<SolicitudRow | null> {
    const { data, error } = await this.supabase
      .from('solicitudes_inscripcion')
      .select()
      .eq('correo', correo)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data;
  }

  private async getOrThrow(solicitudId: string): Promise<SolicitudRow> {
    const { data, error } = await this.supabase
      .from('solicitudes_inscripcion')
      .select()
      .eq('id', solicitudId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('La solicitud no existe', 404);
    }
    return data;
  }

  // Borra los archivos de Storage y luego las filas: si Storage falla no
  // se pierde la referencia a archivos que seguirían existiendo.
  private async borrarDocumentos(solicitudId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('solicitud_documentos')
      .select()
      .eq('solicitud_id', solicitudId);
    if (error) {
      throw error;
    }
    if (data.length === 0) {
      return;
    }

    const { error: removeError } = await this.supabase.storage
      .from(SOLICITUDES_BUCKET)
      .remove(data.map((d) => d.storage_path));
    if (removeError) {
      throw new AppError('No se pudieron eliminar los documentos anteriores', 502);
    }

    const { error: deleteError } = await this.supabase
      .from('solicitud_documentos')
      .delete()
      .eq('solicitud_id', solicitudId);
    if (deleteError) {
      throw deleteError;
    }
  }

  private async signPaths(paths: string[]): Promise<Map<string, string>> {
    const urlByPath = new Map<string, string>();
    if (paths.length === 0) {
      return urlByPath;
    }

    const { data, error } = await this.supabase.storage
      .from(SOLICITUDES_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error) {
      throw new AppError('No se pudieron generar los enlaces de los documentos', 502);
    }
    for (const item of data) {
      if (item.path && item.signedUrl) {
        urlByPath.set(item.path, item.signedUrl);
      }
    }
    return urlByPath;
  }

  private buildChecklist(
    solicitud: SolicitudRow,
    documentos: DocumentoRow[],
    urlByPath: Map<string, string>,
  ): ChecklistItem[] {
    const exentaDePapeleta =
      solicitud.fecha_nacimiento !== null &&
      calcularEdad(solicitud.fecha_nacimiento) >= EDAD_EXENCION_PAPELETA;

    return TIPOS_DOCUMENTO.map((tipo) => {
      const doc = documentos.find((d) => d.tipo_documento === tipo);
      if (!doc) {
        return {
          tipoDocumento: tipo,
          estado: tipo === 'papeleta_votacion' && exentaDePapeleta ? 'no_aplica' : 'faltante',
          documentoId: null,
          url: null,
          motivoRechazo: null,
          uploadedAt: null,
          reviewedAt: null,
        };
      }
      return {
        tipoDocumento: tipo,
        estado: doc.estado,
        documentoId: doc.id,
        url: urlByPath.get(doc.storage_path) ?? null,
        motivoRechazo: doc.motivo_rechazo,
        uploadedAt: doc.uploaded_at,
        reviewedAt: doc.reviewed_at,
      };
    });
  }
}
