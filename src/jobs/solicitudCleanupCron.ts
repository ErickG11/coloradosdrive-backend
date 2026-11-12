import { observeJob } from '../services/enrollmentObservation.service';
import cron from 'node-cron';

import { supabaseAdmin } from '../config/supabase';
import { SolicitudCleanupService } from '../services/solicitudCleanup.service';

const cleanupService = new SolicitudCleanupService(supabaseAdmin);

// Vencimientos y retención de solicitudes de inscripción: una vez al día (03:00, zona de la escuela
// explícita): devueltas vencidas, borradores, rechazadas, certificados verificados y huérfanos de
// Storage. Usa node-cron dentro del proceso Express, igual que practiceSlotCron.ts (ver ADR 001);
// no depende de que pg_cron esté habilitado en Supabase.
export function startSolicitudCleanupCron(): void {
  let running = false;
  cron.schedule(
    '0 3 * * *',
    () => {
      if (running) return;
      running = true;
      observeJob('cleanup', () => cleanupService.runAll())
        .then((report) => {
          console.warn(JSON.stringify({ event: 'solicitud_cleanup_done', ...report }));
        })
        .catch(() => {
          console.error('solicitud_cleanup_failed');
        })
        .finally(() => {
          running = false;
        });
    },
    { timezone: 'America/Guayaquil' },
  );
}
