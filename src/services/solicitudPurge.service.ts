import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import { solicitudError } from '../utils/solicitudError';
import { CERTIFICATE_BUCKET } from './solicitudCertificateStorage.service';

export type PurgeAction = 'solicitud_eliminada' | 'purga_borrador' | 'purga_retencion';

// Helper único de purga (Storage + filas) para DELETE /admin/solicitudes/:id y los trabajos
// programados. Reclama la fila (reviewed_by/at) para excluir decisiones en curso, borra primero
// los archivos —si falla conserva las rutas— y después las filas en una función SQL atómica.
export class SolicitudPurgeService {
  constructor(private readonly db: SupabaseClient<Database>) {}

  // actor null = trabajo programado. Devuelve false solo si la solicitud ya no existe.
  async purge(id: string, actor: string | null, action: PurgeAction): Promise<boolean> {
    const { data: row, error } = await this.db
      .from('solicitudes_inscripcion')
      .select('estado,reviewed_at,reviewed_by,enviada_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      if (actor) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
      return false;
    }
    // El admin no ve borradores; su existencia no se revela.
    if (actor && row.estado === 'borrador')
      throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    if (row.estado === 'aprobada')
      throw solicitudError('Una solicitud aprobada no se puede eliminar', 409, 'SOLICITUD_CERRADA');
    // Enviada o devuelta con reclamación activa: hay una decisión en curso.
    if (['enviada', 'devuelta'].includes(row.estado) && row.reviewed_at)
      throw solicitudError('La solicitud está en resolución', 409, 'SOLICITUD_CERRADA');

    const claim = new Date().toISOString();
    let claimQuery = this.db
      .from('solicitudes_inscripcion')
      .update({ reviewed_at: claim, reviewed_by: actor })
      .eq('id', id)
      .eq('estado', row.estado);
    claimQuery = row.reviewed_at
      ? claimQuery.eq('reviewed_at', row.reviewed_at)
      : claimQuery.is('reviewed_at', null);
    const locked = await claimQuery.select('id').maybeSingle();
    if (locked.error) throw locked.error;
    if (!locked.data) throw solicitudError('La solicitud está en resolución', 409, 'SOLICITUD_CERRADA');

    try {
      const docs = await this.db
        .from('solicitud_documentos')
        .select('storage_path')
        .eq('solicitud_id', id);
      if (docs.error) throw docs.error;
      const paths = (docs.data as { storage_path: string | null }[])
        .map((d) => d.storage_path)
        .filter((p): p is string => p !== null);
      if (paths.length > 0) {
        const removed = await this.db.storage.from(CERTIFICATE_BUCKET).remove(paths);
        if (removed.error)
          throw solicitudError(
            'No se pudieron eliminar los archivos; puedes reintentar',
            502,
            'SERVICIO_NO_DISPONIBLE',
          );
      }
      const deleted = await this.db.rpc('eliminar_solicitud_reclamada', {
        p_solicitud: id,
        p_claim: claim,
        p_actor: actor,
        p_accion: action,
      });
      if (deleted.error) throw deleted.error;
      return true;
    } catch (err) {
      // Con Storage fallido las rutas siguen en la fila; con SQL fallido se puede reintentar.
      const release = await this.db
        .from('solicitudes_inscripcion')
        .update({ reviewed_at: row.reviewed_at, reviewed_by: row.reviewed_by })
        .eq('id', id)
        .eq('reviewed_at', claim)
        .eq('estado', row.estado);
      if (release.error) console.error(JSON.stringify({ event: 'solicitud_purge_release_failed' }));
      throw err;
    }
  }
}
