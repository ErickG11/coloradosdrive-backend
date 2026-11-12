import { observeJob } from '../services/enrollmentObservation.service';
import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { BillingService } from '../services/billing.service';
import { ManualBillingPort } from '../services/billing/billingPort';
import { logSafeError } from '../utils/safeLog';
export function startBillingCron(): void {
  const service = new BillingService(supabaseAdmin, new ManualBillingPort());
  let running = false;
  cron.schedule(
    '*/5 * * * *',
    () => {
      if (running) return;
      running = true;
      void observeJob('billing', () => service.run())
        .catch((error: unknown) => logSafeError('billing_queue_failed', error))
        .finally(() => {
          running = false;
        });
    },
    { timezone: 'America/Guayaquil' },
  );
}
