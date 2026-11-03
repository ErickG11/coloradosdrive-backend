import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { env } from '../config/env';
import { PRIVACY_NOTICE_VERSION } from '../config/privacy';
import { calcularEdad } from '../utils/solicitudAge';
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
  async requireConsent(id: string): Promise<Consent> {
    const consent = await this.currentConsent(id);
    if (!consent) throw solicitudError('Acepta el aviso de privacidad vigente', 409, 'CONSENTIMIENTO_REQUERIDO');
    return consent;
  }
  async accept(id: string, input: { versionAviso: unknown; aceptoTratamiento: unknown; declaraVeracidad: unknown }): Promise<{ version: string }> {
    if (input.versionAviso !== PRIVACY_NOTICE_VERSION) throw solicitudError('El aviso cambió. Revisa la versión vigente', 409, 'AVISO_DESACTUALIZADO');
    if (input.aceptoTratamiento !== true || input.declaraVeracidad !== true) throw solicitudError('Debes aceptar ambas declaraciones', 400, 'CONSENTIMIENTO_REQUERIDO');
    const { data: row, error: rowError } = await this.db.from('solicitudes_inscripcion').select('correo_verificado,estado,reviewed_at,enviada_at').eq('id', id).maybeSingle();
    if (rowError) throw rowError;
    if (!row) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    if (!row.correo_verificado) throw solicitudError('Verifica tu correo', 403, 'ACCESO_DENEGADO');
    if (row.enviada_at) throw solicitudError('La solicitud ya fue enviada',409,'SOLICITUD_ENVIADA');
    if (row.estado === 'rechazada' || row.estado === 'aprobada' || (row.estado === 'pendiente_revision' && row.reviewed_at)) throw solicitudError('La solicitud está cerrada o en resolución', 409, 'SOLICITUD_CERRADA');
    const { error } = await this.db.from('solicitud_consentimientos').upsert({
      solicitud_id: id, version_aviso: PRIVACY_NOTICE_VERSION, acepto_tratamiento: true, declara_veracidad: true,
    }, { onConflict: 'solicitud_id,version_aviso', ignoreDuplicates: true });
    if (error) throw error;
    return { version: PRIVACY_NOTICE_VERSION };
  }
  async progress(id: string): Promise<{
    courseId: string; estado: string; enviadaAt:string|null; motivoRechazo?:string|null; correoVerificado: boolean; consentimientoVigente: boolean;
    datosGuardados: boolean; solicitadaAt: string | null; requiereRepresentante: boolean;
    representanteCompleto: boolean; documentos: { tipo: string; estado: string; motivoRechazo: string | null }[];
  }> {
    const { data: row, error } = await this.db.from('solicitudes_inscripcion').select().eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    const consent = await this.currentConsent(id);
    const { data: docs, error: docsError } = await this.db.from('solicitud_documentos')
      .select('tipo_documento,estado,motivo_rechazo').eq('solicitud_id', id);
    if (docsError) throw docsError;
    return {
      courseId: row.course_id, estado: row.estado==='pendiente_revision'?(row.enviada_at?'enviada':'borrador'):row.estado, enviadaAt:row.enviada_at??null, ...(row.estado==='rechazada'?{motivoRechazo:row.motivo_rechazo}:{}), correoVerificado: row.correo_verificado,
      consentimientoVigente: Boolean(consent), datosGuardados: Boolean(row.cedula && row.solicitada_at),
      solicitadaAt: row.solicitada_at,
      requiereRepresentante: Boolean(row.fecha_nacimiento && calcularEdad(row.fecha_nacimiento) < 18),
      representanteCompleto: Boolean(consent?.representante_acepta && consent.representante_nombre && consent.representante_cedula),
      documentos: docs.map(d => ({ tipo: d.tipo_documento, estado: d.estado, motivoRechazo: d.motivo_rechazo ?? null })),
    };
  }
}
