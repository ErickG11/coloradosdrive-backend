import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { env } from '../config/env';
import { AccountService } from './account.service';
import { logSolicitudFailure } from '../utils/solicitudLog';

export class SolicitudApprovalRecoveryService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly accounts = new AccountService(db),
  ) {}

  // La aprobación normal y el cron comparten la misma compensación con lease SQL.
  async compensar(intentoId: string, forzar = false): Promise<boolean> {
    const lease = await this.db.rpc('tomar_recuperacion_aprobacion', {
      p_intento: intentoId,
      p_ttl: env.APPROVAL_CLAIM_TTL_MINUTES,
      p_forzar: forzar,
    });
    if (lease.error) throw lease.error;
    if (!lease.data) return false;
    await this.accounts.compensarCuentaInscripcion(lease.data.intentoId, lease.data.solicitudId);
    const closed = await this.db.rpc('cerrar_recuperacion_aprobacion', {
      p_intento: intentoId,
      p_token: lease.data.token,
    });
    if (closed.error) throw closed.error;
    return closed.data;
  }

  async run(): Promise<{ compensadas: number; legacyLiberadas: number; fallos: number }> {
    const report = { compensadas: 0, legacyLiberadas: 0, fallos: 0 };
    const cutoff = new Date(Date.now() - env.APPROVAL_CLAIM_TTL_MINUTES * 60_000).toISOString();
    // Priorizar reclamos pendientes; reservar cinco plazas para creaciones tardías.
    const [active, late, legacy] = await Promise.all([
      this.db
        .from('solicitud_aprobacion_intentos')
        .select('id')
        .in('estado', ['pendiente', 'recuperando'])
        .lt('updated_at', cutoff)
        .order('updated_at')
        .limit(20),
      this.db
        .from('solicitud_aprobacion_intentos')
        .select('id')
        .eq('estado', 'compensado')
        .lt('updated_at', cutoff)
        .order('updated_at')
        .limit(5),
      this.db
        .from('solicitudes_inscripcion')
        .select('id,reviewed_at')
        .eq('estado', 'enviada')
        .not('reviewed_at', 'is', null)
        .lt('reviewed_at', cutoff)
        .order('reviewed_at')
        .limit(20),
    ]);
    if (active.error) throw active.error;
    if (late.error) throw late.error;
    if (legacy.error) throw legacy.error;
    for (const row of [...active.data, ...late.data]) {
      try {
        if (await this.compensar(row.id)) report.compensadas++;
      } catch {
        report.fallos++;
        logSolicitudFailure('approval_recovery_failed');
      }
    }
    for (const row of legacy.data) {
      if (!row.reviewed_at) continue;
      try {
        const result = await this.db.rpc('liberar_reclamo_aprobacion_legacy', {
          p_id: row.id,
          p_claim: row.reviewed_at,
          p_ttl: env.APPROVAL_CLAIM_TTL_MINUTES,
        });
        if (result.error) throw result.error;
        if (result.data) report.legacyLiberadas++;
      } catch {
        report.fallos++;
        logSolicitudFailure('approval_legacy_recovery_failed');
      }
    }
    return report;
  }
}
