import cron from 'node-cron';

import { supabaseAdmin } from '../config/supabase';
import { SolicitudCleanupService } from '../services/solicitudCleanup.service';

const cleanupService = new SolicitudCleanupService(supabaseAdmin);

// Solicitudes de inscripción: una vez al día (03:00) elimina las que llevan
// más de 7 días como borrador, con sus documentos; también aplica retención de rechazadas. Usa node-cron
// dentro del proceso Express, igual que practiceSlotCron.ts (ver ADR 001);
// no depende de que pg_cron esté habilitado en Supabase.
export function startSolicitudCleanupCron(): void {
  cron.schedule('0 3 * * *', () => {
    cleanupService
      .purgeAbandoned()
      .then((count) => {
        if (count > 0) {
          console.warn(`Solicitudes abandonadas eliminadas: ${String(count)}`);
        }
      })
      .catch(() => {
        console.error('solicitud_cleanup_failed');
      });
  }, { timezone: 'America/Guayaquil' });
}
