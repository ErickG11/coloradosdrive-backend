import { supabaseAdmin } from '../config/supabase';
import { mailer } from '../config/mailer';
import { EmailService } from './email.service';
import { PaymentWelcomeService } from './paymentWelcome.service';
import type { StudentPayment } from '../models/studentPayment.model';
export const paymentWelcome = new PaymentWelcomeService(supabaseAdmin, new EmailService(mailer));
export async function paymentWithWelcome(
  payment: StudentPayment,
): Promise<StudentPayment & { correoEnviado: boolean }> {
  return {
    ...payment,
    correoEnviado: payment.estado === 'aprobado' ? await paymentWelcome.deliver(payment.id) : false,
  };
}
