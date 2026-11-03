import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { env } from '../config/env';
import { SolicitudDeletionService } from './solicitudDeletion.service';
export const ABANDONED_AFTER_DAYS = 7;
const DAY_MS = 86400000;
export class SolicitudCleanupService {
  constructor(private readonly supabase: SupabaseClient<Database>, private readonly retentionDays = env.SOLICITUD_RETENCION_DIAS) {}
  async purgeAbandoned(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - Math.min(ABANDONED_AFTER_DAYS, this.retentionDays) * DAY_MS).toISOString();
    const { data: rows, error } = await this.supabase.from('solicitudes_inscripcion').select('id,estado,created_at,reviewed_at,enviada_at')
      .in('estado', ['pendiente_revision', 'rechazada']).lt('created_at', cutoff);
    if (error) throw error;
    let count = 0;
    const deletion = new SolicitudDeletionService(this.supabase);
    for (const row of rows) {
      if (row.estado === 'pendiente_revision' && (row.reviewed_at || row.enviada_at)) continue;
      const base = row.estado === 'rechazada' ? row.reviewed_at ?? row.created_at : row.created_at;
      const age = (now.getTime() - new Date(base).getTime()) / DAY_MS;
      const retentionDue = age >= this.retentionDays;
      if (row.estado === 'pendiente_revision' ? age < ABANDONED_AFTER_DAYS : !retentionDue) continue;
      try {
        if (await deletion.remove(row.id, null, 'purga_retencion', false)) count++;
      } catch { console.error('solicitud_cleanup_item_failed'); }
    }
    return count;
  }
}
