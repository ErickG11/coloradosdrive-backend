import { enrollmentRuleEnabled } from './enrollmentRuleFlags.service';
import { createHash, randomInt } from 'node:crypto';
import { EnrollmentLimitsService } from './enrollmentLimits.service';
import type { EnrollmentSummary } from '../models/enrollmentLimits.model';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import {
  type CompletarDatosResult,
  type ConfirmarCodigoResult,
  type SolicitudDocumentoResult,
} from '../models/solicitud.model';
import { SolicitudPrivacyService } from './solicitudPrivacy.service';
import { logSolicitudFailure } from '../utils/solicitudLog';
import { solicitudError } from '../utils/solicitudError';
import { AppError } from '../utils/AppError';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '../config/privacy';
import { normalizeSolicitudError } from '../utils/solicitudError';
import { SolicitudCertificateStorage } from './solicitudCertificateStorage.service';
import { prepareCertificate } from '../utils/certificateFile';
import { NIVELES_ESTUDIOS, type NivelEstudios } from '../config/enrollmentCatalog';
import { env } from '../config/env';
import { enrollmentRateKey } from '../utils/enrollmentRateKey';
import { normalizeEnrollmentEmail, requireKnownFields } from '../utils/enrollmentSanitization';
import {
  validateCertificateSubtype,
  validateEnrollmentData,
  validateVerificationCode,
} from '../utils/enrollmentValidation';
import { signSolicitudToken } from '../utils/solicitudToken';
import type { AccountService } from './account.service';
import type { CohortAssignmentService } from './cohortAssignment.service';
import type { EmailService } from './email.service';

type SolicitudRow = Database['public']['Tables']['solicitudes_inscripcion']['Row'];

export const SOLICITUDES_BUCKET = 'solicitudes-documentos';
export const CODE_TTL_MINUTES = 15;
export const MAX_CODE_ATTEMPTS = env.ENROLLMENT_FAILED_CODES_PER_EMAIL_DAILY_CAP;

// Filtro barato en Multer, ANTES de bufferizar el archivo completo (ver
// middlewares/upload.ts): usa el Content-Type que declara el cliente,
// que es falsificable. Es solo para rechazar temprano lo obviamente no
// permitido; la decisión de seguridad real es detectFileType() sobre el
// contenido ya bufferizado, más abajo en subirDocumento().
export const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'application/pdf'];

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export { calcularEdad } from '../utils/solicitudAge';

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
    // Sin uso desde que la aprobación vive en SolicitudApprovalService; se conservan por firma.
    readonly accountService: AccountService,
    readonly cohortAssignmentService: CohortAssignmentService,
  ) {}

  // ---------------------------------------------------------------------
  // Verificación de correo
  // ---------------------------------------------------------------------
  async verificarCorreo(correoInput: string, courseId: string): Promise<void> {
    const correo = normalizeEnrollmentEmail(correoInput).correo;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const { data, error } = await this.supabase.rpc('emitir_codigo_inscripcion', {
      p_correo: correo,
      p_curso: courseId,
      p_codigo_hash: hashCode(code),
      p_expira: new Date(Date.now() + CODE_TTL_MINUTES * 60000).toISOString(),
      p_correo_hash: enrollmentRateKey('correo', correo, env.ENROLLMENT_RATE_HMAC_SECRET),
      p_topes: new EnrollmentLimitsService(this.supabase).topes(),
    });
    if (error) throw error;
    if (data?.motivo === 'cerradas')
      throw solicitudError(
        'Las inscripciones están cerradas. Contacta a la escuela.',
        503,
        'INSCRIPCIONES_CERRADAS',
      );
    if (data?.motivo === 'limite')
      throw solicitudError(
        'Se alcanzó el cupo diario de solicitudes. Contacta a la escuela.',
        429,
        'CUPO_DIARIO_AGOTADO',
      );
    if (data?.emitir !== true || !data.correo) return;
    try {
      await this.emailService.sendVerificationCodeEmail({
        to: data.correo,
        code,
        expiresInMinutes: CODE_TTL_MINUTES,
      });
    } catch {
      logSolicitudFailure('verification_email_failed');
    }
  }

  async confirmarCodigo(correoInput: string, codigo: string): Promise<ConfirmarCodigoResult> {
    const correo = normalizeEnrollmentEmail(correoInput).correo;
    validateVerificationCode(codigo);
    const { data, error } = await this.supabase.rpc('confirmar_codigo_inscripcion', {
      p_correo: correo,
      p_codigo_hash: hashCode(codigo),
      p_correo_hash: enrollmentRateKey('correo', correo, env.ENROLLMENT_RATE_HMAC_SECRET),
      p_topes: new EnrollmentLimitsService(this.supabase).topes(),
    });
    if (error || !data)
      throw solicitudError(
        'No se pudo comprobar el código. Intenta de nuevo.',
        503,
        'VERIFICACION_NO_DISPONIBLE',
      );
    if (data.resultado === 'limite')
      throw solicitudError(
        'Alcanzaste el máximo diario de intentos. Intenta mañana.',
        429,
        'CUPO_DIARIO_AGOTADO',
      );
    if (data.resultado !== 'valido' || !data.id || !data.scope)
      throw solicitudError('Código inválido o vencido', 400, 'CODIGO_INVALIDO_O_VENCIDO');
    return { solicitudId: data.id, token: signSolicitudToken(data.id, undefined, data.scope) };
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
    const validated = validateEnrollmentData(
      input,
      course.data.edad_minima,
      new Date(),
      await enrollmentRuleEnabled(this.supabase, 'foreign_identity'),
    );
    // Lista explícita: nombreCompleto lo deriva el trigger, nunca el cliente.
    const { data, error } = await this.supabase.rpc('guardar_datos_inscripcion', {
      p_id: solicitudId,
      p_version_aviso: PRIVACY_NOTICE_VERSION,
      p_version_terminos: TERMS_VERSION,
      p_datos: {
        nombres: validated.nombres,
        apellidos: validated.apellidos,
        cedula:
          validated.documentType && validated.documentType !== 'cedula' ? null : validated.cedula,
        ...(validated.documentType
          ? { documentType: validated.documentType, documentNumber: validated.documentNumber }
          : {}),
        fechaNacimiento: validated.fechaNacimiento,
        telefono: validated.telefono,
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
      throw solicitudError(
        'Completa tus datos y tu nivel de estudios primero',
        409,
        'DATOS_REQUERIDOS',
      );
    const config = NIVELES_ESTUDIOS[nivel as NivelEstudios];
    if (config.archivo === 'ninguno')
      throw solicitudError(
        'Tu nivel de estudios no requiere archivo',
        409,
        'NIVEL_NO_REQUIERE_ARCHIVO',
      );
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
  async resumen(): Promise<EnrollmentSummary> {
    return new EnrollmentLimitsService(this.supabase).summary();
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

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
}
