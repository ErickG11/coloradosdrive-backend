import { observeJob } from '../services/enrollmentObservation.service';
import cron from 'node-cron';
import { paymentWelcome } from '../services/paymentWelcome';
import { logSafeError } from '../utils/safeLog';
export function startPaymentWelcomeCron(): void {
  let running = false;
  cron.schedule(
    '* * * * *',
    () => {
      if (running) return;
      running = true;
      observeJob('payment_welcome', () => paymentWelcome.run())
        .catch((error: unknown) => {
          logSafeError('payment_welcome_retry_failed', error);
        })
        .finally(() => {
          running = false;
        });
    },
    { timezone: 'America/Guayaquil' },
  );
}
