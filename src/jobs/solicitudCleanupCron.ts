import cron from 'node-cron';

import { supabaseAdmin } from '../config/supabase';
import { SolicitudCleanupService } from '../services/solicitudCleanup.service';

const cleanupService = new SolicitudCleanupService(supabaseAdmin);

// Solicitudes de inscripción: una vez al día (03:00) elimina las que llevan
// más de 7 días en 'pendiente_revision' sin ningún documento. Usa node-cron
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
      .catch((err: unknown) => {
        console.error('Error en la limpieza de solicitudes abandonadas:', err);
      });
  });
}
