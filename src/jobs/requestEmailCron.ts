import { observeJob } from '../services/enrollmentObservation.service';
import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { mailer } from '../config/mailer';
import { EmailService } from '../services/email.service';
import { RequestEmailService } from '../services/requestEmail.service';
import { logSafeError } from '../utils/safeLog';
export function startRequestEmailCron(): void {
  const service = new RequestEmailService(supabaseAdmin, new EmailService(mailer));
  let running = false;
  cron.schedule(
    '* * * * *',
    () => {
      if (running) return;
      running = true;
      void observeJob('request_email', () => service.run())
        .catch((error: unknown) => {
          logSafeError('request_email_failed', error);
        })
        .finally(() => {
          running = false;
        });
    },
    { timezone: 'America/Guayaquil' },
  );
}
