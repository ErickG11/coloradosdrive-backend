import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import { MOTIVOS_RECHAZO, RETENCION_INSCRIPCION } from '../config/enrollmentCatalog';
import { env } from '../config/env';
import { recordSolicitudAudit } from './solicitudAudit.service';
import { CERTIFICATE_BUCKET } from './solicitudCertificateStorage.service';
import { SolicitudPurgeService } from './solicitudPurge.service';

const DAY_MS = 86_400_000;
const ORPHAN_BATCH = 200;
const BATCH = 200;

export interface CleanupReport {
  vencidas: number;
  borradores: number;
  rechazadas: number;
  certificados: number;
  huerfanos: number;
}

// Trabajos de vencimiento y retención. Un elemento que falla no detiene a los demás; solo se
// cuenta lo que realmente se procesó. El informe y los logs no contienen datos personales.
export class SolicitudCleanupService {
  private readonly purger: SolicitudPurgeService;

  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly retentionDays = env.SOLICITUD_RETENCION_DIAS,
  ) {
    this.purger = new SolicitudPurgeService(db);
  }

  async runAll(now: Date = new Date()): Promise<CleanupReport> {
    const report: CleanupReport = {
      vencidas: await this.step('expire_returned', () => this.expireReturned()),
      borradores: await this.step('purge_drafts', () => this.purgeDrafts(now)),
      rechazadas: await this.step('purge_rejected', () => this.purgeRejected(now)),
      certificados: await this.step('purge_certificates', () => this.purgeCertificates(now)),
      huerfanos: await this.step('purge_orphans', () => this.purgeOrphans(now)),
    };
    return report;
  }

  private async step(name: string, run: () => Promise<number>): Promise<number> {
    try {
      return await run();
    } catch {
      console.error(JSON.stringify({ event: 'solicitud_cleanup_step_failed', step: name }));
      return 0;
    }
  }

  private cutoff(now: Date, days: number): string {
    return new Date(now.getTime() - days * DAY_MS).toISOString();
  }

  // Devuelta sin reenviar a tiempo: rechazada con VENCIDA (sin correo).
  async expireReturned(): Promise<number> {
    const { data, error } = await this.db.rpc('vencer_solicitudes_devueltas', {
      p_dias: RETENCION_INSCRIPCION.devueltaDias,
      p_mensaje: MOTIVOS_RECHAZO.VENCIDA.mensaje,
    });
    if (error) throw error;
    return data ?? 0;
  }

  async purgeDrafts(now: Date): Promise<number> {
    const { data, error } = await this.db
      .from('solicitudes_inscripcion')
      .select('id')
      .eq('estado', 'borrador')
      .lt('created_at', this.cutoff(now, RETENCION_INSCRIPCION.borradorDias))
      .order('created_at')
      .limit(BATCH);
    if (error) throw error;
    return this.purgeAll(
      data.map((r) => r.id),
      'purga_borrador',
    );
  }

  async purgeRejected(now: Date): Promise<number> {
    const { data, error } = await this.db
      .from('solicitudes_inscripcion')
      .select('id')
      .eq('estado', 'rechazada')
      .lt('reviewed_at', this.cutoff(now, this.retentionDays))
      .order('reviewed_at')
      .limit(BATCH);
    if (error) throw error;
    return this.purgeAll(
      data.map((r) => r.id),
      'purga_retencion',
    );
  }

  private async purgeAll(ids: string[], action: 'purga_borrador' | 'purga_retencion'): Promise<number> {
    let count = 0;
    for (const id of ids) {
      try {
        if (await this.purger.purge(id, null, action)) count++;
      } catch {
        console.error(JSON.stringify({ event: 'solicitud_purge_item_failed', action }));
      }
    }
    return count;
  }

  // Certificado verificado: se borra el archivo a los 30 días; queda la fila (quién, cómo, cuándo).
  async purgeCertificates(now: Date): Promise<number> {
    const { data, error } = await this.db
      .from('solicitud_documentos')
      .select('id,solicitud_id,storage_path')
      .eq('tipo_documento', 'certificado_estudios')
      .not('storage_path', 'is', null)
      .lt('archivo_verificado_at', this.cutoff(now, RETENCION_INSCRIPCION.certificadoVerificadoDias))
      .order('archivo_verificado_at')
      .limit(BATCH);
    if (error) throw error;
    let count = 0;
    for (const doc of data) {
      const ruta = doc.storage_path as string | null;
      if (!ruta) continue;
      try {
        const removed = await this.db.storage.from(CERTIFICATE_BUCKET).remove([ruta]);
        if (removed.error) throw removed.error;
        const updated = await this.db
          .from('solicitud_documentos')
          .update({ storage_path: null, archivo_eliminado_at: new Date().toISOString() })
          .eq('id', doc.id)
          .eq('storage_path', ruta);
        if (updated.error) throw updated.error;
        await recordSolicitudAudit(this.db, doc.solicitud_id, null, 'certificado_purgado', doc.id);
        count++;
      } catch {
        console.error(JSON.stringify({ event: 'solicitud_certificate_purge_failed' }));
      }
    }
    return count;
  }

  // Objetos sin fila que los referencie, de más de un día (subidas que no se confirmaron).
  async purgeOrphans(now: Date): Promise<number> {
    const { data, error } = await this.db.rpc('listar_objetos_huerfanos_solicitudes', {
      p_antes: this.cutoff(now, RETENCION_INSCRIPCION.huerfanoDias),
      p_limite: ORPHAN_BATCH,
    });
    if (error) throw error;
    if (!data || data.length === 0) return 0;
    const removed = await this.db.storage.from(CERTIFICATE_BUCKET).remove(data);
    if (removed.error) throw removed.error;
    return data.length;
  }
}
