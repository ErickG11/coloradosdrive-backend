import { createApp } from './app';
import { env } from './config/env';
import { applyServerTimeouts } from './config/serverHardening';
import { startPracticeSlotCron } from './jobs/practiceSlotCron';
import { startSolicitudCleanupCron } from './jobs/solicitudCleanupCron';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.warn(`ColoradosDrive backend listening on port ${String(env.PORT)} (${env.NODE_ENV})`);
});
applyServerTimeouts(server);

if (process.env.DISABLE_CRON !== 'true') {
  startPracticeSlotCron();
  startSolicitudCleanupCron();
} else {
  console.warn('Crons de prácticas y solicitudes desactivados (DISABLE_CRON=true)');
}
