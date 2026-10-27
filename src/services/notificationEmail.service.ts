import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { NotificationRow } from '../models/notification.model';
import type { EmailService } from './email.service';

function deliveryError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message.slice(0, 1000);
  }
  return 'No se pudo enviar el correo';
}

export class NotificationEmailService {
  constructor(private readonly supabase: SupabaseClient<Database>, private readonly email: EmailService) {}

  async runOnce(): Promise<void> {
    const deadline = Date.now() + 45_000;
    for (let i = 0; i < 20 && Date.now() < deadline; i += 1) {
      const { data, error } = await this.supabase.rpc('claim_notification_email').maybeSingle();
      if (error) throw error;
      if (!data) return;
      let failure: string | null = null;
      try { await this.send(data); }
      catch (err) { failure = deliveryError(err); }
      if (!data.email_lease_token) throw new Error('Correo reservado sin token');
      const { data: finished, error: finishError } = await this.supabase.rpc('finish_notification_email', {
        p_id: data.id, p_token: data.email_lease_token, p_error: failure,
      });
      if (finishError) throw finishError;
      if (!finished) throw new Error('La reserva del correo cambió antes de confirmar el envío');
    }
  }

  private async send(notification: NotificationRow): Promise<void> {
    if (!notification.scheduled_at) throw new Error('El aviso no tiene fecha de práctica');
    const { data: user, error } = await this.supabase.from('users').select('nombre_completo,activo')
      .eq('id', notification.user_id).maybeSingle();
    if (error) throw error;
    if (!user?.activo) throw new Error('Destinatario inactivo o inexistente');
    const { data: auth, error: authError } = await this.supabase.auth.admin.getUserById(notification.user_id);
    if (authError) throw authError;
    if (!auth.user.email) throw new Error('Correo del usuario no disponible');
    const params = {
      to: auth.user.email, nombreCompleto: user.nombre_completo, scheduledAt: notification.scheduled_at,
      messageId: `<${notification.id}@notifications.coloradosdrive>`,
    };
    if (notification.tipo === 'recordatorio_practica') await this.email.sendPracticeConfirmationRequestEmail(params);
    else if (notification.tipo === 'sin_practica_instructor') await this.email.sendNoPracticeEmail(params);
    else throw new Error('Este tipo de aviso no requiere correo');
  }
}
