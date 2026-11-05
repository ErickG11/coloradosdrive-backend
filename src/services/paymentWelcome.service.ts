import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { EmailService } from './email.service';
import { logSafeError } from '../utils/safeLog';
export class PaymentWelcomeService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly email: EmailService,
  ) {}
  async deliver(id: string): Promise<boolean> {
    let token: string | null = null;
    try {
      const claim = await this.db.rpc('claim_payment_email', { p_id: id });
      if (claim.error) throw claim.error;
      token = claim.data;
      if (!token) {
        const status = await this.db
          .from('payment_mail_outbox')
          .select('estado')
          .eq('payment_id', id)
          .maybeSingle();
        if (status.error) throw status.error;
        return status.data?.estado === 'enviado';
      }
      const payment = await this.db
        .from('payments')
        .select('student_id,estado')
        .eq('id', id)
        .single();
      if (payment.error) throw payment.error;
      if (payment.data.estado !== 'aprobado' || !payment.data.student_id)
        throw new Error('payment_not_approved');
      const [profile, user] = await Promise.all([
        this.db.from('users').select('nombre_completo').eq('id', payment.data.student_id).single(),
        this.db.auth.admin.getUserById(payment.data.student_id),
      ]);
      if (profile.error || user.error || !user.data.user.email)
        throw new Error('recipient_unavailable');
      await this.email.sendPaymentWelcomeEmail({
        to: user.data.user.email,
        nombreCompleto: profile.data.nombre_completo,
        paymentId: id,
      });
      const finish = await this.db.rpc('finish_payment_email', {
        p_id: id,
        p_token: token,
        p_ok: true,
      });
      if (finish.error) logSafeError('payment_welcome_ack_failed', finish.error);
      return true;
    } catch (error) {
      logSafeError('payment_welcome_failed', error);
      if (token) {
        try {
          const finish = await this.db.rpc('finish_payment_email', {
            p_id: id,
            p_token: token,
            p_ok: false,
          });
          if (finish.error) logSafeError('payment_welcome_ack_failed', finish.error);
        } catch (ackError) {
          logSafeError('payment_welcome_ack_failed', ackError);
        }
      }
      return false;
    }
  }
  async run(): Promise<{ enviados: number; fallos: number }> {
    const result = await this.db
      .from('payment_mail_outbox')
      .select('payment_id')
      .in('estado', ['pendiente', 'enviando'])
      .lt('intentos', 5)
      .order('next_attempt_at')
      .limit(20);
    if (result.error) throw result.error;
    const report = { enviados: 0, fallos: 0 };
    for (const row of result.data) {
      if (await this.deliver(row.payment_id)) report.enviados++;
      else report.fallos++;
    }
    return report;
  }
}
