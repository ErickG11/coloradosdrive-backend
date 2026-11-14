import { observeJob } from '../services/enrollmentObservation.service';
import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { SolicitudApprovalRecoveryService } from '../services/solicitudApprovalRecovery.service';

export function startSolicitudApprovalRecoveryCron(): void {
  const service = new SolicitudApprovalRecoveryService(supabaseAdmin);
  let running = false;
  cron.schedule(
    '*/5 * * * *',
    () => {
      if (running) return;
      running = true;
      observeJob('approval_recovery', () => service.run())
        .then((report) => {
          console.warn(JSON.stringify({ event: 'approval_recovery_done', ...report }));
        })
        .catch(() => {
          console.error('approval_recovery_failed');
        })
        .finally(() => {
          running = false;
        });
    },
    { timezone: 'America/Guayaquil' },
  );
}
