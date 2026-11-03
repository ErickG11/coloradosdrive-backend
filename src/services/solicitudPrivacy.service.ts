import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { env } from '../config/env';
import { PRIVACY_NOTICE_VERSION } from '../config/privacy';
import { MOTIVOS_RECHAZO } from '../config/enrollmentCatalog';
import { calcularEdad } from '../utils/solicitudAge';
import { solicitudError } from '../utils/solicitudError';

type Consent = Database['public']['Tables']['solicitud_consentimientos']['Row'];
export function privacyNotice(): {
  version: string;
  contactoDerechos: string;
  retencionDias: number;
} {
  return {
    version: PRIVACY_NOTICE_VERSION,
    contactoDerechos: env.PRIVACY_CONTACT_EMAIL,
    retencionDias: env.SOLICITUD_RETENCION_DIAS,
  };
}
export class SolicitudPrivacyService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  async currentConsent(id: string): Promise<Consent | null> {
    const { data, error } = await this.db
      .from('solicitud_consentimientos')
      .select()
      .eq('solicitud_id', id)
      .eq('version_aviso', PRIVACY_NOTICE_VERSION)
      .maybeSingle();
    if (error) throw error;
    return data?.acepto_tratamiento && data.declara_veracidad ? data : null;
  }
  async requireConsent(id: string): Promise<Consent> {
    const consent = await this.currentConsent(id);
    if (!consent)
      throw solicitudError(
        'Acepta el aviso de privacidad vigente',
        409,
        'CONSENTIMIENTO_REQUERIDO',
      );
    return consent;
  }
  async accept(
    id: string,
    input: { versionAviso: unknown; aceptoTratamiento: unknown; declaraVeracidad: unknown },
  ): Promise<{ version: string }> {
    if (input.versionAviso !== PRIVACY_NOTICE_VERSION)
      throw solicitudError(
        'El aviso cambió. Revisa la versión vigente',
        409,
        'AVISO_DESACTUALIZADO',
      );
    if (input.aceptoTratamiento !== true || input.declaraVeracidad !== true)
      throw solicitudError('Debes aceptar ambas declaraciones', 400, 'CONSENTIMIENTO_REQUERIDO');
    const { data: row, error: rowError } = await this.db
      .from('solicitudes_inscripcion')
      .select('correo_verificado,estado,reviewed_at,enviada_at')
      .eq('id', id)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    if (!row.correo_verificado) throw solicitudError('Verifica tu correo', 403, 'ACCESO_DENEGADO');
    if (row.enviada_at)
      throw solicitudError('La solicitud ya fue enviada', 409, 'SOLICITUD_ENVIADA');
    if (row.estado === 'rechazada' || row.estado === 'aprobada' || row.reviewed_at)
      throw solicitudError('La solicitud está cerrada o en resolución', 409, 'SOLICITUD_CERRADA');
    const { error } = await this.db.from('solicitud_consentimientos').upsert(
      {
        solicitud_id: id,
        version_aviso: PRIVACY_NOTICE_VERSION,
        acepto_tratamiento: true,
        declara_veracidad: true,
      },
      { onConflict: 'solicitud_id,version_aviso', ignoreDuplicates: true },
    );
    if (error) throw error;
    return { version: PRIVACY_NOTICE_VERSION };
  }
  async progress(id: string): Promise<{
    courseId: string;
    curso: { id: string; tipo: 'A' | 'B'; nombre: string; edadMinima: number } | null;
    estado: string;
    enviadaAt: string | null;
    correoVerificado: boolean;
    consentimientoVigente: boolean;
    datosGuardados: boolean;
    solicitadaAt: string | null;
    requiereRepresentante: boolean;
    representanteCompleto: boolean;
    nivelEstudios: string | null;
    documentoRequerido: boolean;
    documentoEstudiosPendientePorCupo: boolean;
    devolucion: {
      motivoCodigo: string | null;
      mensaje: string | null;
      devueltaAt: string | null;
    } | null;
    motivoRechazo?: string | null;
    datos: {
      nombres: string | null;
      apellidos: string | null;
      cedula: string | null;
      fechaNacimiento: string | null;
      telefono: string | null;
      nacionalidadTipo: string | null;
      tipoSangre: string | null;
    };
    pasosCompletos: {
      correo: boolean;
      consentimiento: boolean;
      datos: boolean;
      estudios: boolean;
      enviada: boolean;
    };
    documentos: { tipo: string; estado: string; motivoRechazo: string | null }[];
  }> {
    const { data: row, error } = await this.db
      .from('solicitudes_inscripcion')
      .select()
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    const consent = await this.currentConsent(id);
    const docs = await this.db
      .from('solicitud_documentos')
      .select('tipo_documento,estado,motivo_rechazo')
      .eq('solicitud_id', id)
      .eq('tipo_documento', 'certificado_estudios');
    if (docs.error) throw docs.error;
    const course = await this.db
      .from('courses')
      .select('id,tipo,nombre,edad_minima')
      .eq('id', row.course_id)
      .maybeSingle();
    if (course.error) throw course.error;
    const requerido = ['bachiller_exterior', 'decimo_aprobado', 'cursando_bachillerato'].includes(
      row.nivel_estudios ?? '',
    );
    const guardados = Boolean(
      row.nombres &&
      row.apellidos &&
      row.cedula &&
      row.fecha_nacimiento &&
      row.nacionalidad_tipo &&
      row.tipo_sangre,
    );
    const certificados = docs.data.filter((d) => d.tipo_documento === 'certificado_estudios');
    const rechazo = Object.entries(MOTIVOS_RECHAZO).find(
      ([codigo]) => codigo === row.rechazo_motivo_codigo,
    )?.[1];
    return {
      courseId: row.course_id,
      curso: course.data
        ? {
            id: course.data.id,
            tipo: course.data.tipo,
            nombre: course.data.nombre,
            edadMinima: course.data.edad_minima,
          }
        : null,
      estado: row.estado,
      enviadaAt: row.enviada_at ?? null,
      correoVerificado: row.correo_verificado,
      consentimientoVigente: Boolean(consent),
      datosGuardados: guardados,
      solicitadaAt: row.solicitada_at,
      requiereRepresentante: Boolean(
        row.fecha_nacimiento && calcularEdad(row.fecha_nacimiento) < 18,
      ),
      representanteCompleto: Boolean(
        consent?.representante_acepta &&
        consent.representante_nombre &&
        consent.representante_cedula,
      ),
      nivelEstudios: row.nivel_estudios ?? null,
      documentoRequerido: requerido,
      documentoEstudiosPendientePorCupo: row.documento_estudios_pendiente_por_cupo,
      devolucion:
        row.estado === 'devuelta'
          ? {
              motivoCodigo: row.devolucion_motivo_codigo ?? null,
              mensaje: row.devolucion_mensaje ?? null,
              devueltaAt: row.devuelta_at ?? null,
            }
          : null,
      ...(row.estado === 'rechazada'
        ? {
            motivoRechazo: rechazo?.mensaje ?? row.motivo_rechazo,
          }
        : {}),
      datos: {
        nombres: row.nombres ?? null,
        apellidos: row.apellidos ?? null,
        cedula: row.cedula,
        fechaNacimiento: row.fecha_nacimiento,
        telefono: row.telefono,
        nacionalidadTipo: row.nacionalidad_tipo ?? null,
        tipoSangre: row.tipo_sangre ?? null,
      },
      pasosCompletos: {
        correo: row.correo_verificado,
        consentimiento: Boolean(consent),
        datos: guardados,
        estudios: Boolean(
          row.nivel_estudios &&
          (!requerido || certificados.length || row.documento_estudios_pendiente_por_cupo),
        ),
        enviada: Boolean(row.enviada_at),
      },
      documentos: certificados.map((d) => ({
        tipo: d.tipo_documento,
        estado: d.estado,
        motivoRechazo: d.motivo_rechazo ?? null,
      })),
    };
  }
}
