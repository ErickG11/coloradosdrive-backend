import { heartbeat, monitorEnrollmentRules } from './services/enrollmentObservation.service';
import { startEnrollmentMonitorCron } from './jobs/enrollmentMonitorCron';
import { logSafeError } from './utils/safeLog';
import { startRequestEmailCron } from './jobs/requestEmailCron';
import { startBillingCron } from './jobs/billingCron';
import { startPaymentReconciliationCron } from './jobs/paymentReconciliationCron';
import { startPaymentWelcomeCron } from './jobs/paymentWelcomeCron';
import { startStudentScheduleExpiryCron } from './jobs/studentScheduleExpiryCron';
import { createApp } from './app';
import { env } from './config/env';
import { applyServerTimeouts } from './config/serverHardening';
import { startPracticeSlotCron } from './jobs/practiceSlotCron';
import { startSolicitudApprovalRecoveryCron } from './jobs/solicitudApprovalRecoveryCron';
import { startSolicitudCleanupCron } from './jobs/solicitudCleanupCron';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.warn(`ColoradosDrive backend listening on port ${String(env.PORT)} (${env.NODE_ENV})`);
});
applyServerTimeouts(server);

void heartbeat(
  'startup',
  'ok',
  env.NODE_ENV === 'production' && process.env.DISABLE_CRON === 'true',
)
  .then(monitorEnrollmentRules)
  .catch((e: unknown) => {
    logSafeError('enrollment_startup_monitor_failed', e);
  });
startEnrollmentMonitorCron();
if (process.env.DISABLE_CRON !== 'true') {
  startPracticeSlotCron();
  startStudentScheduleExpiryCron();
  startPaymentWelcomeCron();
  startPaymentReconciliationCron();
  startBillingCron();
  startRequestEmailCron();
  startSolicitudCleanupCron();
  startSolicitudApprovalRecoveryCron();
} else {
  console.warn('Crons de prácticas, solicitudes y reservas desactivados (DISABLE_CRON=true)');
}
