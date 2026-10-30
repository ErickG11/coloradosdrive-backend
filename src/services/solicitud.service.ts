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
import { calcularEdad, validateApplicant } from '../utils/solicitudAge';
import { SolicitudPrivacyService } from './solicitudPrivacy.service';
import { solicitudError } from '../utils/solicitudError';
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

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function isUniqueViolation(error: PostgrestError | null): boolean {
  return error?.code === POSTGRES_UNIQUE_VIOLATION;
}

export { calcularEdad } from '../utils/solicitudAge';

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

    const selectedCourse = existing?.solicitada_at ? existing.course_id : courseId;
    const { data: course, error: courseError } = await this.supabase.from('courses')
      .select('id').eq('id', selectedCourse).maybeSingle();
    if (courseError) throw courseError;
    if (!course) throw solicitudError('El curso no existe', 404, 'CURSO_NO_ENCONTRADO');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeFields = {
      // El curso se guarda/actualiza aquí también en un reintento: si el
      // postulante vuelve a pedir código para otro curso, esta solicitud
      // en progreso refleja su elección más reciente.
      course_id: selectedCourse,
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
    const invalid = new AppError('Código inválido o vencido', 400, { code: 'CODIGO_INVALIDO_O_VENCIDO' });
    for (let retry = 0; retry < 5; retry++) {
      const row = await this.findByCorreo(correo);
      if (!row?.codigo_verificacion || !row.codigo_expira_at ||
          new Date(row.codigo_expira_at).getTime() <= Date.now()) throw invalid;
      const expected = Buffer.from(row.codigo_verificacion, 'hex');
      const received = Buffer.from(hashCode(codigo), 'hex');
      const matches = expected.length === received.length && timingSafeEqual(expected, received);
      const attempts = row.intentos_codigo + 1;
      const lockedOut = !matches && attempts >= MAX_CODE_ATTEMPTS;
      const fields = matches
        ? { correo_verificado: true, codigo_verificacion: null, codigo_expira_at: null, intentos_codigo: 0 }
        : lockedOut
          ? { intentos_codigo: attempts, codigo_verificacion: null, codigo_expira_at: null }
          : { intentos_codigo: attempts };
      // CAS: ningún fallo concurrente se pierde y un código correcto se consume una sola vez.
      const { data, error } = await this.supabase.from('solicitudes_inscripcion')
        .update(fields).eq('id', row.id).eq('codigo_verificacion', row.codigo_verificacion)
        .eq('intentos_codigo', row.intentos_codigo).eq('codigo_expira_at', row.codigo_expira_at)
        .gt('codigo_expira_at', new Date().toISOString()).select('id').maybeSingle();
      if (error) throw error;
      if (!data) continue;
      if (matches) return { solicitudId: row.id, token: signSolicitudToken(row.id) };
      if (lockedOut) throw new AppError('Demasiados intentos fallidos. Solicita un nuevo código', 429, { code: 'INTENTOS_AGOTADOS' });
      throw invalid;
    }
    throw invalid;
  }

  // ---------------------------------------------------------------------
  // Datos personales (cédula, nombre, fecha de nacimiento)
  // ---------------------------------------------------------------------
  async completarDatos(
    solicitudId: string,
    input: SolicitudDatosInput,
  ): Promise<CompletarDatosResult> {
    const current = await this.getOrThrow(solicitudId);
    if (!current.correo_verificado) throw solicitudError('Debes verificar tu correo antes de continuar', 403, 'ACCESO_DENEGADO');
    if (current.estado === 'aprobada' || (current.estado === 'pendiente_revision' && current.reviewed_at)) {
      throw solicitudError('La solicitud está cerrada o en resolución', 409, 'SOLICITUD_CERRADA');
    }
    const consent = await new SolicitudPrivacyService(this.supabase).requireConsent(solicitudId);
    const rep = validateApplicant(input.fechaNacimiento, input.representante);
    const { data: conflicts, error: conflictsError } = await this.supabase.from('solicitudes_inscripcion')
      .select('id').eq('cedula', input.cedula).neq('id', solicitudId).in('estado', ['pendiente_revision', 'aprobada']);
    if (conflictsError) throw conflictsError;
    if (conflicts.length) throw solicitudError('Ya existe una solicitud activa para esta cédula', 409, 'CEDULA_ACTIVA');
    if (rep) {
      const { error } = await this.supabase.from('solicitud_consentimientos').update({
        representante_nombre: rep.nombre, representante_cedula: rep.cedula, representante_acepta: true,
      }).eq('id', consent.id);
      if (error) throw error;
    }
    let update = this.supabase.from('solicitudes_inscripcion').update({
      cedula: input.cedula, nombre_completo: input.nombreCompleto, telefono: input.telefono ?? null,
      fecha_nacimiento: input.fechaNacimiento, solicitada_at: current.solicitada_at ?? new Date().toISOString(),
      ...(current.estado === 'rechazada' ? { estado: 'pendiente_revision' as const, motivo_rechazo: null, reviewed_by: null, reviewed_at: null } : {}),
    }).eq('id', solicitudId).eq('estado', current.estado);
    if (current.estado === 'pendiente_revision') update = update.is('reviewed_at', null);
    const { data, error } = await update.select('id').maybeSingle();
    if (error) throw isUniqueViolation(error) ? solicitudError('Ya existe una solicitud activa para esta cédula', 409, 'CEDULA_ACTIVA') : error;
    if (!data) throw solicitudError('La solicitud está cerrada o en resolución', 409, 'SOLICITUD_CERRADA');
    return { solicitudId, token: signSolicitudToken(solicitudId) };
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
      throw solicitudError('Esta solicitud ya no admite documentos', 409, 'SOLICITUD_CERRADA');
    }
    if (!solicitud.cedula || !solicitud.solicitada_at) {
      throw new AppError('Completa tus datos (cédula) antes de subir documentos', 409);
    }

    // El Content-Type que declara el cliente es falsificable (basta con
    // cambiar la extensión al subir); para documentos de identidad se
    // verifica el contenido real por su firma binaria, no lo que dice el
    // multipart. `file.mimetype` ya no se usa para decidir nada de acá en
    // adelante.
    await new SolicitudPrivacyService(this.supabase).requireConsent(solicitudId);
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
  async listarParaAdmin(estado?: SolicitudEstado, page = 1, pageSize = 20, q = ''): Promise<{ items: SolicitudAdminView[]; total: number; page: number; pageSize: number }> {
    // Las filas que solo verificaron el correo (sin cédula) son solicitudes
    // en progreso: todavía no hay nada que revisar.
    let query = this.supabase
      .from('solicitudes_inscripcion')
      .select('*', { count: 'exact' })
      .not('cedula', 'is', null)
      .order('created_at', { ascending: false }).order('id');
    if (estado) {
      query = query.eq('estado', estado);
    }
    // q se limita a caracteres literales para no inyectar operadores PostgREST.
    const search = q.replace(/[^\p{L}\p{N}@. _-]/gu, '').trim();
    if (search) query = query.or(`cedula.ilike.%${search}%,nombre_completo.ilike.%${search}%,correo.ilike.%${search}%`);
    const { data: solicitudes, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) {
      throw error;
    }
    if (solicitudes.length === 0) {
      return { items: [], total: count ?? 0, page, pageSize };
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

    const urlByPath = new Map<string, string>();
    const { data: consents, error: consentError } = await this.supabase.from('solicitud_consentimientos').select().in('solicitud_id', solicitudes.map(s => s.id)).order('aceptado_at', { ascending: false });
    if (consentError) throw consentError;
    const relatedByCedula = await this.findRelatedByCedula(solicitudes);

    const items = solicitudes.map((solicitud) => ({
      ...toAdminView(
        solicitud,
        this.buildChecklist(
          solicitud,
          documentos.filter((d) => d.solicitud_id === solicitud.id),
          urlByPath,
        ),
        (relatedByCedula.get(solicitud.cedula) ?? []).filter((r) => r.id !== solicitud.id),
      ),
      solicitadaAt: solicitud.solicitada_at,
      consentimiento: ((): SolicitudAdminView['consentimiento'] => {
        const c = consents.find(c => c.solicitud_id === solicitud.id);
        return c ? { version: c.version_aviso, aceptadoAt: c.aceptado_at, representanteNombre: c.representante_nombre, representanteCedula: c.representante_cedula, representanteAcepta: c.representante_acepta } : null;
      })(),
    }));
    return { items, total: count ?? 0, page, pageSize };
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
          course_id: courseId,
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
      course_id: courseId,
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
