import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { StudentScheduleExpiryService } from '../services/studentScheduleExpiry.service';
import { logSafeError } from '../utils/safeLog';

export function startStudentScheduleExpiryCron(): void {
  const service = new StudentScheduleExpiryService(supabaseAdmin);
  let running = false;
  cron.schedule(
    '* * * * *',
    () => {
      if (running) return;
      running = true;
      service
        .run()
        .then((report) => {
          if (report.vencidas || report.fallos)
            console.warn(JSON.stringify({ event: 'student_schedule_expiry', ...report }));
        })
        .catch((error: unknown) => {
          logSafeError('student_schedule_expiry_failed', error);
        })
        .finally(() => {
          running = false;
        });
    },
    { timezone: 'America/Guayaquil' },
  );
}
