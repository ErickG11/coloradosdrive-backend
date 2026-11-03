import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { solicitudError } from '../utils/solicitudError';

export class SolicitudDeletionService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  async remove(id: string, actor: string | null, action = 'solicitud_eliminada', onlyWithoutDocs = false): Promise<boolean> {
    const { data: row, error } = await this.db.from('solicitudes_inscripcion').select('estado,reviewed_at,reviewed_by,enviada_at')
      .eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    if (action === 'purga_retencion' && row.estado === 'pendiente_revision' && row.enviada_at) return false;
    if (actor && !row.enviada_at) throw solicitudError('La solicitud no existe',404,'NO_ENCONTRADO');
    if (row.estado === 'aprobada' || (row.estado === 'pendiente_revision' && row.reviewed_at)) throw solicitudError('La solicitud está cerrada o en resolución', 409, 'SOLICITUD_CERRADA');
    const claim = new Date().toISOString();
    let query = this.db.from('solicitudes_inscripcion').update({ reviewed_at: claim, reviewed_by: actor }).eq('id', id).eq('estado', row.estado);
    query = row.reviewed_at ? query.eq('reviewed_at', row.reviewed_at) : query.is('reviewed_at', null);
    if (action === 'purga_retencion' && row.estado === 'pendiente_revision') query = query.is('enviada_at', null);
    const locked = await query.select('id').maybeSingle();
    if (locked.error) throw locked.error;
    if (!locked.data) throw solicitudError('La solicitud está en resolución', 409, 'SOLICITUD_CERRADA');
    try {
      const docs = await this.db.from('solicitud_documentos').select('storage_path').eq('solicitud_id', id);
      if (docs.error) throw docs.error;
      if (onlyWithoutDocs && docs.data.length) {
        const released = await this.db.from('solicitudes_inscripcion').update({ reviewed_at: row.reviewed_at, reviewed_by: row.reviewed_by }).eq('id', id).eq('reviewed_at', claim);
        if (released.error) throw released.error;
        return false;
      }
      if (docs.data.length) {
        const removed = await this.db.storage.from('solicitudes-documentos').remove(docs.data.map(d => d.storage_path));
        if (removed.error) throw solicitudError('No se pudieron eliminar los archivos; puedes reintentar', 502, 'SERVICIO_NO_DISPONIBLE');
      }
      const deleted = await this.db.rpc('eliminar_solicitud_reclamada', { p_solicitud: id, p_claim: claim, p_actor: actor, p_accion: action });
      if (deleted.error) throw deleted.error;
      return true;
    } catch (err) {
      // Si Storage falló no se pierden las rutas; si SQL falló se puede reintentar.
      const release = await this.db.from('solicitudes_inscripcion').update({ reviewed_at: row.reviewed_at, reviewed_by: row.reviewed_by })
        .eq('id', id).eq('reviewed_at', claim).eq('estado', row.estado);
      if (release.error) console.error('solicitud_delete_release_failed');
      throw err;
    }
  }
}
