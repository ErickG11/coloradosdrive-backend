import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { env } from '../config/env';
import { PRIVACY_NOTICE_VERSION } from '../config/privacy';
import { calcularEdad } from './solicitud.service';
import { solicitudError } from '../utils/solicitudError';

type Consent = Database['public']['Tables']['solicitud_consentimientos']['Row'];
export function privacyNotice(): { version: string; contactoDerechos: string; retencionDias: number } {
  return { version: PRIVACY_NOTICE_VERSION, contactoDerechos: env.PRIVACY_CONTACT_EMAIL, retencionDias: env.SOLICITUD_RETENCION_DIAS };
}
export class SolicitudPrivacyService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  async currentConsent(id: string): Promise<Consent | null> {
    const { data, error } = await this.db.from('solicitud_consentimientos').select()
      .eq('solicitud_id', id).eq('version_aviso', PRIVACY_NOTICE_VERSION).maybeSingle();
    if (error) throw error;
    return data?.acepto_tratamiento && data.declara_veracidad ? data : null;
  }
  async progress(id: string): Promise<{
    courseId: string; estado: string; correoVerificado: boolean; consentimientoVigente: boolean;
    datosGuardados: boolean; solicitadaAt: string | null; requiereRepresentante: boolean;
    representanteCompleto: boolean; documentos: { tipo: string; estado: string }[];
  }> {
    const { data: row, error } = await this.db.from('solicitudes_inscripcion').select().eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    const consent = await this.currentConsent(id);
    const { data: docs, error: docsError } = await this.db.from('solicitud_documentos')
      .select('tipo_documento,estado').eq('solicitud_id', id);
    if (docsError) throw docsError;
    return {
      courseId: row.course_id, estado: row.estado, correoVerificado: row.correo_verificado,
      consentimientoVigente: Boolean(consent), datosGuardados: Boolean(row.cedula && row.solicitada_at),
      solicitadaAt: row.solicitada_at,
      requiereRepresentante: Boolean(row.fecha_nacimiento && calcularEdad(row.fecha_nacimiento) < 18),
      representanteCompleto: Boolean(consent?.representante_acepta && consent.representante_nombre && consent.representante_cedula),
      documentos: docs.map(d => ({ tipo: d.tipo_documento, estado: d.estado })),
    };
  }
}
