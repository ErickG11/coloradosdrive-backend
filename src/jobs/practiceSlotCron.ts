import cron from 'node-cron';

import { mailer } from '../config/mailer';
import { supabaseAdmin } from '../config/supabase';
import { EmailService } from '../services/email.service';
import { PracticeSlotSchedulerService } from '../services/practiceSlotScheduler.service';
import { RealtimeService } from '../services/realtime.service';

const schedulerService = new PracticeSlotSchedulerService(
  supabaseAdmin,
  new EmailService(mailer),
  new RealtimeService(supabaseAdmin),
);

// RF-03: revisa cada minuto qué franjas necesitan notificación de 20 min
// antes, cuáles llegaron a los 5 min sin reclamar/confirmar, y cuáles ya
// terminaron. node-cron corre dentro de este mismo proceso Express -
// funciona porque Railway lo mantiene como proceso persistente (ver ADR
// 001); no hace falta un servicio de cron externo, a diferencia de la
// arquitectura monolítica en Vercel que el documento de tesis menciona
// para ese caso.
export function startPracticeSlotCron(): void {
  cron.schedule('* * * * *', () => {
    schedulerService.runOnce().catch((err: unknown) => {
      console.error('Error en la corrida del scheduler de horarios de práctica:', err);
    });
  });
}
