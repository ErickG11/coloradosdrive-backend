import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { PaymentReconciliationService } from '../services/paymentReconciliation.service';
import { UnavailableKushkiReconciliation } from '../services/payments/reconciliationPort';
import { logSafeError } from '../utils/safeLog';
export function startPaymentReconciliationCron(): void {
  const service = new PaymentReconciliationService(
    supabaseAdmin,
    new UnavailableKushkiReconciliation(),
  );
  let running = false;
  cron.schedule(
    '*/15 * * * *',
    () => {
      if (running) return;
      running = true;
      void service
        .run()
        .catch((error: unknown) => logSafeError('payment_reconciliation_failed', error))
        .finally(() => {
          running = false;
        });
    },
    { timezone: 'America/Guayaquil' },
  );
}
