import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { env } from '../config/env';
import { DOCUMENTOS_FISICOS } from '../config/enrollmentCatalog';
import type {
  EnrollmentBudget,
  EnrollmentSummary,
  EnrollmentReservation,
} from '../models/enrollmentLimits.model';
import { enrollmentRateKey } from '../utils/enrollmentRateKey';
import { AppError } from '../utils/AppError';
import { invalidField } from '../utils/solicitudFields';
import { normalizeEnrollmentEmail, requireKnownFields } from '../utils/enrollmentSanitization';

export class EnrollmentLimitsService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly config = env,
  ) {}
  topes(): Record<string, number> {
    return {
      codigos: this.config.ENROLLMENT_CODES_DAILY_CAP,
      solicitudes: this.config.ENROLLMENT_NEW_REQUESTS_DAILY_CAP,
      subidas: this.config.ENROLLMENT_UPLOADS_DAILY_CAP,
      codigosIpHora: this.config.ENROLLMENT_CODES_PER_IP_HOUR,
      codigosCorreoDia: this.config.ENROLLMENT_CODES_PER_EMAIL_DAILY_CAP,
      fallosCorreoDia: this.config.ENROLLMENT_FAILED_CODES_PER_EMAIL_DAILY_CAP,
      cooldownSegundos: this.config.ENROLLMENT_CODE_COOLDOWN_SECONDS,
      subidasIpDia: this.config.ENROLLMENT_UPLOADS_PER_IP_DAILY_CAP,
    };
  }
  private denied(result: EnrollmentReservation): void {
    if (result.motivo === 'cerradas')
      throw new AppError(
        'Las inscripciones están cerradas. Contacta a la escuela por WhatsApp.',
        503,
        { code: 'INSCRIPCIONES_CERRADAS' },
      );
    if (!result.permitido)
      throw new AppError(
        'Se alcanzó el cupo de solicitudes permitido. Reintenta más tarde o contacta a la escuela por WhatsApp.',
        429,
        { code: 'CUPO_DIARIO_AGOTADO' },
      );
  }
  private async reserve(
    operacion: string,
    ip?: string,
    correo?: string,
    solicitudId?: string,
  ): Promise<void> {
    const result = await this.db.rpc('reservar_limite_inscripcion', {
      p_operacion: operacion,
      p_ip_hash:
        ip === undefined
          ? null
          : enrollmentRateKey('ip', ip, this.config.ENROLLMENT_RATE_HMAC_SECRET),
      p_correo_hash:
        correo === undefined
          ? null
          : enrollmentRateKey('correo', correo, this.config.ENROLLMENT_RATE_HMAC_SECRET),
      p_topes: this.topes(),
      p_solicitud: solicitudId ?? null,
    });
    if (result.error || typeof result.data?.permitido !== 'boolean')
      throw new AppError(
        'No se pudo comprobar el cupo de inscripciones. Reintenta más tarde.',
        503,
        { code: 'VERIFICACION_NO_DISPONIBLE' },
      );
    this.denied(result.data);
  }
  async reserveCodeIp(ip: string | undefined): Promise<void> {
    await this.reserve('codigo_ip', ip ?? '');
  }
  async reserveCode(correo: string): Promise<void> {
    await this.reserve('codigo', undefined, correo);
  }
  async recordFailedCode(correo: string): Promise<void> {
    await this.reserve('fallo_codigo', undefined, correo);
  }
  async reserveUpload(ip: string | undefined, id: string): Promise<void> {
    await this.reserve('subida', ip ?? '', undefined, id);
  }
  async createDraft(
    correo: string,
    course: string,
    hash: string,
    expires: string,
  ): Promise<{ id: string; creada: boolean }> {
    const result = await this.db.rpc('crear_borrador_limitado', {
      p_correo: normalizeEnrollmentEmail(correo).correo,
      p_curso: course,
      p_codigo: hash,
      p_expira: expires,
      p_topes: this.topes(),
    });
    if (result.error || !result.data)
      throw new AppError('No se pudo registrar la solicitud.', 503, {
        code: 'VERIFICACION_NO_DISPONIBLE',
      });
    if (result.data.permitido === false)
      this.denied({ permitido: false, motivo: result.data.motivo });
    if (!result.data.id || typeof result.data.creada !== 'boolean')
      throw new AppError('No se pudo registrar la solicitud.', 503, {
        code: 'VERIFICACION_NO_DISPONIBLE',
      });
    return { id: result.data.id, creada: result.data.creada };
  }
  async settings(): Promise<{ inscripcionesAbiertas: boolean }> {
    const result = await this.db
      .from('app_settings')
      .select('inscripciones_abiertas')
      .eq('id', true)
      .single();
    if (result.error || typeof result.data.inscripciones_abiertas !== 'boolean')
      throw new AppError('No se pudo consultar la configuración.', 503, {
        code: 'CONFIGURACION_NO_DISPONIBLE',
      });
    return { inscripcionesAbiertas: result.data.inscripciones_abiertas };
  }
  async updateSettings(actor: string, input: unknown): Promise<{ inscripcionesAbiertas: boolean }> {
    requireKnownFields(input, ['inscripcionesAbiertas']);
    if (typeof input.inscripcionesAbiertas !== 'boolean')
      invalidField('inscripcionesAbiertas', 'Selecciona un estado válido.');
    const result = await this.db.rpc('actualizar_config_inscripcion', {
      p_actor: actor,
      p_abiertas: input.inscripcionesAbiertas,
    });
    if (result.error?.code === '42501')
      throw new AppError('Acceso denegado.', 403, { code: 'ACCESO_DENEGADO' });
    if (result.error || !result.data)
      throw new AppError('No se pudo actualizar la configuración.', 503, {
        code: 'CONFIGURACION_NO_DISPONIBLE',
      });
    return result.data;
  }
  async publicConfig(): Promise<{
    inscripcionesAbiertas: boolean;
    cursos: { id: string; tipo: 'A' | 'B'; nombre: string; edadMinima: number }[];
    versionAviso: string;
    versionTerminos: string;
    contactoDerechos: string;
    retencionDias: number;
    umbralBachillerReciente: number;
    documentosFisicos: typeof DOCUMENTOS_FISICOS;
    captcha: { provider: 'turnstile' | 'off'; siteKey: string | null };
  }> {
    const settings = await this.settings();
    const courses = await this.db
      .from('courses')
      .select('id,tipo,nombre,edad_minima')
      .order('tipo')
      .order('id');
    if (courses.error)
      throw new AppError('No se pudo consultar los cursos.', 503, {
        code: 'CONFIGURACION_NO_DISPONIBLE',
      });
    return {
      ...settings,
      cursos: courses.data.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        nombre: c.nombre,
        edadMinima: c.edad_minima,
      })),
      versionAviso: this.config.PRIVACY_NOTICE_VERSION,
      versionTerminos: this.config.TERMS_VERSION,
      contactoDerechos: this.config.PRIVACY_CONTACT_EMAIL,
      retencionDias: this.config.SOLICITUD_RETENCION_DIAS,
      umbralBachillerReciente: this.config.RECENT_GRAD_MONTHS,
      documentosFisicos: DOCUMENTOS_FISICOS,
      captcha: {
        provider: this.config.CAPTCHA_PROVIDER,
        siteKey:
          this.config.CAPTCHA_PROVIDER === 'turnstile'
            ? this.config.NEXT_PUBLIC_TURNSTILE_SITE_KEY
            : null,
      },
    };
  }
  async summary(): Promise<EnrollmentSummary> {
    const result = await this.db.rpc('resumen_solicitudes');
    if (result.error || !result.data)
      throw new AppError('No se pudo consultar el resumen.', 503, {
        code: 'CONFIGURACION_NO_DISPONIBLE',
      });
    const raw = result.data;
    const budget = (tipo: 'codigos' | 'subidas' | 'solicitudes'): EnrollmentBudget => {
      const usado = raw.contadoresHoy[tipo] ?? 0,
        tope = this.topes()[tipo];
      return { usado, tope, alerta: tope === 0 || usado >= tope * 0.8 };
    };
    const cupoCodigosHoy = budget('codigos'),
      cupoSubidasHoy = budget('subidas'),
      cupoSolicitudesHoy = budget('solicitudes');
    return {
      pendientes: raw.pendientes,
      devueltas: raw.devueltas,
      conMasDe48h: raw.conMasDe48h,
      inscripcionesAbiertas: raw.inscripcionesAbiertas,
      cupoCodigosHoy,
      cupoSubidasHoy,
      cupoSolicitudesHoy,
      alertas: (['codigos', 'subidas', 'solicitudes'] as const).filter(
        (tipo) => budget(tipo).alerta,
      ),
    };
  }
}
