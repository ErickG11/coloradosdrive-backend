import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { EmailService } from './email.service';
import type { RealtimeService } from './realtime.service';

// Los efectos se invocan después del commit. Se conserva el envío best-effort de RF-03.
export class PracticeSlotNotificationService {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly email: EmailService,
    private readonly realtime: RealtimeService,
  ) {}

  async remindStudent(studentId: string, scheduledAt: string): Promise<void> {
    try {
      const contact = await this.getUserContact(studentId);
      await this.email.sendPracticeConfirmationRequestEmail({ ...contact, scheduledAt });
    } catch (err) {
      console.error('No se pudo enviar el recordatorio de práctica:', err);
    }
    await this.broadcastUser(studentId, 'confirmation-requested', scheduledAt);
  }

  async notifyInstructorNoPractice(instructorId: string, scheduledAt: string): Promise<void> {
    try {
      const contact = await this.getUserContact(instructorId);
      await this.email.sendNoPracticeEmail({ ...contact, scheduledAt });
    } catch (err) {
      console.error('No se pudo enviar el correo de sin-práctica al instructor:', err);
    }
    await this.broadcastUser(instructorId, 'no-practice', scheduledAt);
  }

  private async broadcastUser(userId: string, event: string, scheduledAt: string): Promise<void> {
    try {
      await this.realtime.broadcast(`user-${userId}-practice-slots`, event, { scheduledAt });
    } catch (err) {
      console.error(`No se pudo notificar (Realtime) el evento "${event}":`, err);
    }
  }

  private async getUserContact(userId: string): Promise<{ nombreCompleto: string; to: string }> {
    const { data, error } = await this.supabase.from('users')
      .select('nombre_completo,activo').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!data?.activo) throw new Error('Destinatario inactivo o inexistente');
    const { data: auth, error: authError } = await this.supabase.auth.admin.getUserById(userId);
    if (authError) throw authError;
    if (!auth.user.email) throw new Error('Correo del usuario no disponible');
    return { nombreCompleto: data.nombre_completo, to: auth.user.email };
  }
}
