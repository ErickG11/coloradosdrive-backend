import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { solicitudError } from '../utils/solicitudError';

export async function recordSolicitudAudit(db: SupabaseClient<Database>, id: string, actor: string | null, action: string, docId?: string): Promise<void> {
  const { error } = await db.from('solicitud_auditoria').insert({ solicitud_id: id, actor_id: actor, accion: action, documento_id: docId ?? null });
  if (error) throw solicitudError('No se pudo registrar la operación', 503, 'AUDITORIA_NO_DISPONIBLE');
}
export class SolicitudDocumentAccessService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  async url(id: string, docId: string, actor: string): Promise<{ url: string; expiresIn: number }> {
    const solicitud=await this.db.from('solicitudes_inscripcion').select('id').eq('id',id).not('enviada_at','is',null).maybeSingle();
    if(solicitud.error)throw solicitud.error;
    if(!solicitud.data)throw solicitudError('La solicitud no existe',404,'NO_ENCONTRADO');
    const { data: doc, error } = await this.db.from('solicitud_documentos').select('storage_path')
      .eq('id', docId).eq('solicitud_id', id).maybeSingle();
    if (error) throw error;
    if (!doc) throw solicitudError('El documento no existe en esta solicitud', 404, 'NO_ENCONTRADO');
    await recordSolicitudAudit(this.db, id, actor, 'abrir_documento', docId);
    const { data, error: signError } = await this.db.storage.from('solicitudes-documentos').createSignedUrl(doc.storage_path, 300);
    if (signError) throw solicitudError('No se pudo abrir el documento', 502, 'SERVICIO_NO_DISPONIBLE');
    return { url: data.signedUrl, expiresIn: 300 };
  }
}
