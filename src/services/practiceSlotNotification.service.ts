import type { RealtimeService } from './realtime.service';

// SQL ya guardó la bandeja y el correo pendiente. Realtime solo invalida la UI.
export class PracticeSlotNotificationService {
  constructor(private readonly realtime: RealtimeService) {}

  async remindStudent(studentId: string, scheduledAt: string): Promise<void> {
    await this.broadcastUser(studentId, 'confirmation-requested', scheduledAt);
  }

  async notifyInstructorNoPractice(instructorId: string, scheduledAt: string): Promise<void> {
    await this.broadcastUser(instructorId, 'no-practice', scheduledAt);
  }

  private async broadcastUser(userId: string, event: string, scheduledAt: string): Promise<void> {
    try {
      await this.realtime.broadcast(`user-${userId}-practice-slots`, event, { scheduledAt });
    } catch (err) {
      console.error(`No se pudo notificar (Realtime) el evento "${event}":`, err);
    }
  }
}
