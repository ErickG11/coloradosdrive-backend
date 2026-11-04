import type { RealtimeService } from './realtime.service';
import { logSafeError } from '../utils/safeLog';

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
      logSafeError('practice_slot_realtime_failed', err);
    }
  }
}
