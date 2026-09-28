import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';

// Antigüedad a partir de la cual una solicitud SIN ningún documento se
// considera abandonada. Las que tienen al menos un documento nunca
// expiran automáticamente: esperan revisión humana sin importar cuánto
// tarde el admin.
export const ABANDONED_AFTER_DAYS = 7;

export class SolicitudCleanupService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  // Devuelve cuántas solicitudes se eliminaron.
  async purgeAbandoned(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ABANDONED_AFTER_DAYS * 24 * 60 * 60_000).toISOString();

    const { data: old, error } = await this.supabase
      .from('solicitudes_inscripcion')
      .select('id')
      .eq('estado', 'pendiente_revision')
      .lt('created_at', cutoff);
    if (error) {
      throw error;
    }
    if (old.length === 0) {
      return 0;
    }

    const { data: withDocs, error: docsError } = await this.supabase
      .from('solicitud_documentos')
      .select('solicitud_id')
      .in(
        'solicitud_id',
        old.map((s) => s.id),
      );
    if (docsError) {
      throw docsError;
    }

    const protectedIds = new Set(withDocs.map((d) => d.solicitud_id));
    const abandonedIds = old.map((s) => s.id).filter((id) => !protectedIds.has(id));
    if (abandonedIds.length === 0) {
      return 0;
    }

    // Si justo entre las dos consultas se subió un documento, la FK
    // (on delete restrict) hace fallar este delete en vez de perderlo.
    const { error: deleteError } = await this.supabase
      .from('solicitudes_inscripcion')
      .delete()
      .in('id', abandonedIds)
      .eq('estado', 'pendiente_revision');
    if (deleteError) {
      throw deleteError;
    }

    return abandonedIds.length;
  }
}
