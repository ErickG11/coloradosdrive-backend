import { createHash, randomInt } from 'node:crypto';
import { EnrollmentLimitsService } from './enrollmentLimits.service';
import type { EnrollmentSummary } from '../models/enrollmentLimits.model';

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
  type SolicitudDocumentoResult,
  type SolicitudEstado,
} from '../models/solicitud.model';
import { calcularEdad, validateApplicant } from '../utils/solicitudAge';
import { SolicitudPrivacyService } from './solicitudPrivacy.service';
import { recordSolicitudAudit } from './solicitudAudit.service';
import { logSolicitudFailure } from '../utils/solicitudLog';
import { solicitudError } from '../utils/solicitudError';
import { AppError } from '../utils/AppError';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '../config/privacy';
import { normalizeSolicitudError } from '../utils/solicitudError';
import { NotificationService } from './notification.service';
import { SolicitudCertificateStorage } from './solicitudCertificateStorage.service';
import { prepareCertificate } from '../utils/certificateFile';
import { NIVELES_ESTUDIOS, type NivelEstudios } from '../config/enrollmentCatalog';
import { env } from '../config/env';
import { enrollmentRateKey } from '../utils/enrollmentRateKey';
import { normalizeEnrollmentEmail, requireKnownFields } from '../utils/enrollmentSanitization';
import { validateCertificateSubtype, validateEnrollmentData, validateVerificationCode } from '../utils/enrollmentValidation';
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
export const MAX_CODE_ATTEMPTS = env.ENROLLMENT_FAILED_CODES_PER_EMAIL_DAILY_CAP;
const POSTGRES_UNIQUE_VIOLATION = '23505';

// Filtro barato en Multer, ANTES de bufferizar el archivo completo (ver
// middlewares/upload.ts): usa el Content-Type que declara el cliente,
// que es falsificable. Es solo para rechazar temprano lo obviamente no
// permitido; la decisión de seguridad real es detectFileType() sobre el
// contenido ya bufferizado, más abajo en subirDocumento().
export const ALLOWED_MIMETYPES = ['image/jpeg','image/png','application/pdf'];

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
  cohorteAsignada?: { cohortId: string | null; estado: string };
}

// Recibe el cliente de Supabase y los servicios por constructor para poder
// mockearlos en tests.
export interface EnviarResult {
  id: string;
  estado: 'enviada';
  enviadaAt: string;
}

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
    const correo=normalizeEnrollmentEmail(correoInput).correo;
    const code=String(randomInt(0,1_000_000)).padStart(6,'0');
    const {data,error}=await this.supabase.rpc('emitir_codigo_inscripcion',{
      p_correo:correo,p_curso:courseId,p_codigo_hash:hashCode(code),
      p_expira:new Date(Date.now()+CODE_TTL_MINUTES*60000).toISOString(),
      p_correo_hash:enrollmentRateKey('correo',correo,env.ENROLLMENT_RATE_HMAC_SECRET),
      p_topes:new EnrollmentLimitsService(this.supabase).topes(),
    });
    if(error)throw error;
    if(data?.motivo==='cerradas')throw solicitudError('Las inscripciones están cerradas. Contacta a la escuela.',503,'INSCRIPCIONES_CERRADAS');
    if(data?.motivo==='limite')throw solicitudError('Se alcanzó el cupo diario de solicitudes. Contacta a la escuela.',429,'CUPO_DIARIO_AGOTADO');
    if(data?.emitir!==true||!data.correo)return;
    try {await this.emailService.sendVerificationCodeEmail({to:data.correo,code,expiresInMinutes:CODE_TTL_MINUTES});}
    catch {logSolicitudFailure('verification_email_failed');}
  }

  async confirmarCodigo(correoInput:string,codigo:string):Promise<ConfirmarCodigoResult> {
    const correo=normalizeEnrollmentEmail(correoInput).correo;
    validateVerificationCode(codigo);
    const {data,error}=await this.supabase.rpc('confirmar_codigo_inscripcion',{
      p_correo:correo,p_codigo_hash:hashCode(codigo),
      p_correo_hash:enrollmentRateKey('correo',correo,env.ENROLLMENT_RATE_HMAC_SECRET),
      p_topes:new EnrollmentLimitsService(this.supabase).topes(),
    });
    if(error||!data)throw solicitudError('No se pudo comprobar el código. Intenta de nuevo.',503,'VERIFICACION_NO_DISPONIBLE');
    if(data.resultado==='limite')throw solicitudError('Alcanzaste el máximo diario de intentos. Intenta mañana.',429,'CUPO_DIARIO_AGOTADO');
    if(data.resultado!=='valido'||!data.id||!data.scope)throw solicitudError('Código inválido o vencido',400,'CODIGO_INVALIDO_O_VENCIDO');
    return {solicitudId:data.id,token:signSolicitudToken(data.id,undefined,data.scope)};
  }

  // ---------------------------------------------------------------------
  // Datos personales (cédula, nombre, fecha de nacimiento)
  // ---------------------------------------------------------------------
  async completarDatos(solicitudId: string, input: unknown): Promise<CompletarDatosResult> {
    const current = await this.getOrThrow(solicitudId);
    if (!current.correo_verificado)
      throw solicitudError('Verifica tu correo antes de continuar.', 403, 'CORREO_NO_VERIFICADO');
    if (!['borrador', 'devuelta'].includes(current.estado))
      throw solicitudError('La solicitud ya no admite cambios.', 409, 'SOLICITUD_CERRADA');
    await new SolicitudPrivacyService(this.supabase).requireConsent(solicitudId);
    const course = await this.supabase
      .from('courses')
      .select('edad_minima')
      .eq('id', current.course_id)
      .maybeSingle();
    if (course.error) throw course.error;
    if (!course.data)
      throw solicitudError(
        'El curso no está disponible. Contacta a la escuela.',
        503,
        'CURSO_NO_DISPONIBLE',
      );
    const validated = validateEnrollmentData(input, course.data.edad_minima);
    // Lista explícita: nombreCompleto lo deriva el trigger, nunca el cliente.
    const { data, error } = await this.supabase.rpc('guardar_datos_inscripcion', {
      p_id: solicitudId,
      p_version_aviso: PRIVACY_NOTICE_VERSION,
      p_version_terminos: TERMS_VERSION,
      p_datos: {
        nombres: validated.nombres,
        apellidos: validated.apellidos,
        cedula: validated.cedula,
        fechaNacimiento: validated.fechaNacimiento,
        telefono: validated.telefono ?? null,
        nacionalidadTipo: validated.nacionalidadTipo,
        tipoSangre: validated.tipoSangre,
        ...(validated.nivelEstudios ? { nivelEstudios: validated.nivelEstudios } : {}),
        ...(validated.representante ? { representante: validated.representante } : {}),
      },
    });
    if (error) throw normalizeSolicitudError(error);
    if (data?.id !== solicitudId)
      throw solicitudError('No se pudo guardar. Intenta de nuevo.', 503, 'SERVICIO_NO_DISPONIBLE');
    return { solicitudId, token: signSolicitudToken(solicitudId, undefined, 'edicion') };
  }

  // ---------------------------------------------------------------------
  // Documentos
  // ---------------------------------------------------------------------
  // Una sola transición atómica en SQL; repetirla es idempotente y no repite el correo.
  async enviar(id: string): Promise<EnviarResult> {
    return this.transicionEnvio(id, 'enviar');
  }

  async reenviar(id: string): Promise<EnviarResult> {
    return this.transicionEnvio(id, 'reenviar');
  }

  private async transicionEnvio(id: string, modo: 'enviar' | 'reenviar'): Promise<EnviarResult> {
    const { data, error } = await this.supabase.rpc('enviar_solicitud_inscripcion', {
      p_id: id,
      p_modo: modo,
      p_version_aviso: PRIVACY_NOTICE_VERSION,
      p_version_terminos: TERMS_VERSION,
    });
    if (error) throw normalizeSolicitudError(error);
    if (!data)
      throw solicitudError('No se pudo enviar. Intenta de nuevo.', 503, 'SERVICIO_NO_DISPONIBLE');
    if (data.transicion) {
      // El acuse es de cortesía: un fallo de correo nunca deshace el envío.
      const { data: row } = await this.supabase
        .from('solicitudes_inscripcion')
        .select('correo')
        .eq('id', id)
        .maybeSingle();
      if (row?.correo) {
        try {
          await this.emailService.sendApplicationReceivedEmail({
            to: row.correo,
            reenvio: modo === 'reenviar',
          });
        } catch {
          logSolicitudFailure('received_email_failed');
        }
      }
    }
    return { id: data.id, estado: data.estado, enviadaAt: data.enviadaAt };
  }

  // Un solo certificado de estudios, solo si el nivel declarado lo admite. Los filtros de
  // tamaño y los topes ya corrieron antes de leer el archivo (middlewares de la ruta).
  async subirCertificado(
    solicitudId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    body: unknown,
  ): Promise<SolicitudDocumentoResult> {
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    requireKnownFields(fields, ['subtipo']);
    const solicitud = await this.getOrThrow(solicitudId);
    if (!['borrador', 'devuelta'].includes(solicitud.estado))
      throw solicitudError('Esta solicitud ya no admite documentos', 409, 'SOLICITUD_CERRADA');
    if (!solicitud.correo_verificado)
      throw solicitudError('Verifica tu correo', 403, 'CORREO_NO_VERIFICADO');
    const nivel = solicitud.nivel_estudios;
    if (!nivel || !solicitud.datos_actualizados_at || !(nivel in NIVELES_ESTUDIOS))
      throw solicitudError('Completa tus datos y tu nivel de estudios primero', 409, 'DATOS_REQUERIDOS');
    const config = NIVELES_ESTUDIOS[nivel as NivelEstudios];
    if (config.archivo === 'ninguno')
      throw solicitudError('Tu nivel de estudios no requiere archivo', 409, 'NIVEL_NO_REQUIERE_ARCHIVO');
    const subtipo = validateCertificateSubtype(nivel as NivelEstudios, fields.subtipo);
    const prepared = await prepareCertificate(file);
    return new SolicitudCertificateStorage(this.supabase).save(
      solicitudId,
      { nivel, marca: solicitud.datos_actualizados_at },
      subtipo,
      prepared,
    );
  }

  // ---------------------------------------------------------------------
  // Panel del admin
  // ---------------------------------------------------------------------
  async resumen():Promise<EnrollmentSummary>{return new EnrollmentLimitsService(this.supabase).summary();}

  async listarParaAdmin(estado?: SolicitudEstado | 'con_documentos_por_revisar', page = 1, pageSize = 20, q = ''): Promise<{ items: SolicitudAdminView[]; total: number; page: number; pageSize: number }> {
    // Las filas que solo verificaron el correo (sin cédula) son solicitudes
    // en progreso: todavía no hay nada que revisar.
    let query = this.supabase
      .from('solicitudes_admin')
      .select('*', { count: 'exact' })
      .not('enviada_at', 'is', null)
      .order('orden_grupo').order('pendiente_desde',{ascending:true,nullsFirst:false}).order('decidida_at',{ascending:false,nullsFirst:false}).order('id');
    if (estado === 'con_documentos_por_revisar') query=query.gt('documentos_por_revisar',0).in('estado',['pendiente_revision','aprobada']);
    else if (estado) {
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
        (relatedByCedula.get(solicitud.cedula ?? '') ?? []).filter((r) => r.id !== solicitud.id),
      ),
      solicitadaAt: solicitud.solicitada_at,
      enviadaAt: solicitud.enviada_at,
      documentosPorRevisar: solicitud.documentos_por_revisar,
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
      .in('cedula', cedulas).not('enviada_at', 'is', null);
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
    adminId: string,
    input: { estado: 'aprobado' | 'rechazado'; motivoRechazo?: string },
  ): Promise<{ id: string; estado: 'aprobado' | 'rechazado' }> {
    if (input.estado === 'rechazado' && !input.motivoRechazo?.trim()) throw solicitudError('Indica el motivo del rechazo', 400, 'MOTIVO_REQUERIDO');
    const row=await this.getOrThrow(solicitudId);
    if(!row.enviada_at)throw solicitudError('La solicitud no ha sido enviada',409,'SOLICITUD_NO_ENVIADA');
    if(row.estado==='rechazada'||(row.estado==='pendiente_revision'&&row.reviewed_at))throw solicitudError('La solicitud está cerrada o en resolución',409,'SOLICITUD_CERRADA');
    const doc=await this.supabase.from('solicitud_documentos').select('id,estado').eq('id',documentoId).eq('solicitud_id',solicitudId).maybeSingle();
    if(doc.error)throw doc.error;
    if(!doc.data)throw solicitudError('El documento no existe en esta solicitud',404,'NO_ENCONTRADO');
    if(doc.data.estado!=='recibido')throw solicitudError('Este documento ya fue revisado',409,'DOCUMENTO_YA_REVISADO');
    return new NotificationService(this.supabase).reviewDocument(solicitudId,documentoId,adminId,input);
  }

  async decidir(
    solicitudId: string,
    adminId: string,
    input: DecidirSolicitudInput,
  ): Promise<DecidirSolicitudResult> {
    if (input.estado === 'rechazada' && !input.motivoRechazo?.trim()) throw solicitudError('Indica el motivo del rechazo', 400, 'MOTIVO_REQUERIDO');
    const solicitud = await this.getOrThrow(solicitudId);
    if (!solicitud.enviada_at) throw solicitudError('La solicitud no ha sido enviada',409,'SOLICITUD_NO_ENVIADA');
    if (solicitud.estado !== 'pendiente_revision' || solicitud.reviewed_at) {
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
        .eq('estado', 'pendiente_revision').is('reviewed_at', null)
        .select()
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        throw new AppError('La solicitud ya fue resuelta', 409);
      }
      await recordSolicitudAudit(this.supabase, solicitudId, adminId, 'solicitud_rechazada');
      let correoEnviado = true;
      try { await this.emailService.sendApplicationRejectedEmail({ to: solicitud.correo, motivo: input.motivoRechazo?.trim() ?? '' }); }
      catch { correoEnviado = false; }
      return { id: solicitudId, estado: 'rechazada', studentId: null, correoEnviado };
    }

    if (!solicitud.cedula || !solicitud.nombre_completo || !solicitud.fecha_nacimiento || !solicitud.correo_verificado || !solicitud.solicitada_at) {
      throw solicitudError('La solicitud no tiene los datos completos para aprobarse', 409, 'DATOS_INCOMPLETOS');
    }
    const consent = await new SolicitudPrivacyService(this.supabase).requireConsent(solicitudId);
    validateApplicant(solicitud.fecha_nacimiento, {
      nombre: consent.representante_nombre, cedula: consent.representante_cedula, acepta: consent.representante_acepta,
    });
    // Reclamo CAS antes de Auth: una sola decisión puede crear la cuenta.
    const claim = await this.supabase.from('solicitudes_inscripcion')
      .update({ reviewed_by: adminId, reviewed_at: reviewedAt }).eq('id', solicitudId)
      .eq('estado', 'pendiente_revision').is('reviewed_at', null).select('id').maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) throw solicitudError('La solicitud está cerrada o en resolución', 409, 'SOLICITUD_CERRADA');
    let account: { userId: string; temporaryPassword: string } | null = null;
    let assigned: { id: string; cohortId: string | null; estado: string };
    let uncertain = false;
    try {
      account = await this.accountService.crearCuentaConClaveTemporal(solicitud.correo);
      const { error } = await this.supabase.from('users').insert({
        id: account.userId, cedula: solicitud.cedula, nombre_completo: solicitud.nombre_completo,
        telefono: solicitud.telefono, fecha_nacimiento: solicitud.fecha_nacimiento,
        rol: 'estudiante', status: 'verificado', debe_cambiar_password: true,
      });
      if (error) throw isUniqueViolation(error) ? solicitudError('Ya existe un usuario con esta cédula', 409, 'CEDULA_ACTIVA') : error;
      assigned = await this.crearEnrollmentConAsignacion(account.userId, solicitud.course_id, new Date(solicitud.solicitada_at));
      const result = await this.supabase.rpc('finalizar_aprobacion_solicitud', {
        p_solicitud: solicitudId, p_actor: adminId, p_claim: reviewedAt, p_student: account.userId, p_enrollment: assigned.id,
      });
      if (result.error) {
        // Una respuesta perdida puede ocultar una transacción ya confirmada.
        const confirmed = await this.supabase.from('solicitudes_inscripcion').select('estado,student_id').eq('id', solicitudId).maybeSingle();
        if (confirmed.error) {
          uncertain = true;
          throw solicitudError('No se pudo confirmar la aprobación. Recarga antes de reintentar', 503, 'APROBACION_NO_CONFIRMADA');
        }
        if (confirmed.data?.estado !== 'aprobada' || confirmed.data.student_id !== account.userId) throw result.error;
      }
    } catch (err) {
      if (uncertain) throw err;
      if (account) {
        await this.eliminarEnrollmentDeEstudiante(account.userId);
        await this.accountService.eliminarCuenta(account.userId);
      }
      const released = await this.supabase.from('solicitudes_inscripcion').update({ reviewed_at: null, reviewed_by: null })
        .eq('id', solicitudId).eq('estado', 'pendiente_revision').eq('reviewed_at', reviewedAt);
      if (released.error) console.error('solicitud_claim_release_failed');
      throw err;
    }
    let correoEnviado = true;
    try {
      await this.emailService.sendApplicationApprovedEmail({ to: solicitud.correo, nombreCompleto: solicitud.nombre_completo, temporaryPassword: account.temporaryPassword });
    } catch { correoEnviado = false; }
    return { id: solicitudId, estado: 'aprobada', studentId: account.userId, correoEnviado,
      cohorteAsignada: { cohortId: assigned.cohortId, estado: assigned.estado } };
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
  private async crearEnrollmentConAsignacion(studentId: string, courseId: string, requestedAt: Date): Promise<{ id: string; cohortId: string | null; estado: string }> {
    const excluded: string[] = [];
    for (let attempt = 0; attempt < MAX_INTENTOS_ASIGNACION_COHORTE; attempt++) {
      const chosen = await this.cohortAssignmentService.assignCohortForSolicitud(courseId, requestedAt, excluded);
      try {
        const estado = chosen.cohortId ? 'activo' as const : 'pendiente_cohorte' as const;
        const { data, error } = await this.supabase.from('enrollments').insert({
          student_id: studentId, course_id: courseId, cohort_id: chosen.cohortId,
          status: estado, monto_total: chosen.precio,
        }).select('id').single();
        if (error) throw error;
        return { id: data.id, cohortId: chosen.cohortId, estado };
      } catch (err) {
        if (isCupoExceededError(err) && chosen.cohortId) { excluded.push(chosen.cohortId); continue; }
        throw err;
      }
    }
    const { data, error } = await this.supabase.from('enrollments').insert({
      student_id: studentId, course_id: courseId, cohort_id: null, status: 'pendiente_cohorte', monto_total: null,
    }).select('id').single();
    if (error) throw error;
    return { id: data.id, cohortId: null, estado: 'pendiente_cohorte' };
  }

  // Compensación best-effort (igual que AccountService.eliminarCuenta):
  // si falla, solo se registra, nunca enmascara el error original que
  // disparó el rollback.
  private async eliminarEnrollmentDeEstudiante(studentId: string): Promise<void> {
    const { error } = await this.supabase.from('enrollments').delete().eq('student_id', studentId);
    if (error) {
      logSolicitudFailure('enrollment_rollback_failed');
    }
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
