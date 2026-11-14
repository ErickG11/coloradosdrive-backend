import cron from 'node-cron';
import { env } from '../config/env';
import {
  heartbeat,
  observeJob,
  monitorEnrollmentRules,
} from '../services/enrollmentObservation.service';
import { logSafeError } from '../utils/safeLog';
export function startEnrollmentMonitorCron(): void {
  let running = false;
  cron.schedule(
    '*/5 * * * *',
    () => {
      if (running) return;
      running = true;
      void observeJob('monitor', async () => {
        await heartbeat(
          'startup',
          'ok',
          env.NODE_ENV === 'production' && process.env.DISABLE_CRON === 'true',
        );
        await monitorEnrollmentRules();
      })
        .catch((e: unknown) => {
          logSafeError('enrollment_monitor_failed', e);
        })
        .finally(() => {
          running = false;
        });
    },
    { timezone: 'America/Guayaquil' },
  );
}
