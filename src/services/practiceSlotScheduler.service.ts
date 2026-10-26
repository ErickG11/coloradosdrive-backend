import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { EmailService } from './email.service';
import type { RealtimeService } from './realtime.service';
import { PracticeSlotNotificationService } from './practiceSlotNotification.service';

type SchedulerTransition = 'remind' | 'close' | 'complete';
type Candidate = Database['public']['Functions']['practice_slots_scheduler_candidates']['Returns'][number];

// PostgreSQL selecciona candidatos y decide estado/plazo de nuevo al escribir.
// El reloj de Node no participa en las decisiones (ADR 009).
export class PracticeSlotSchedulerService {
  private readonly notifications: PracticeSlotNotificationService;
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    emailService: EmailService,
    realtimeService: RealtimeService,
  ) {
    this.notifications = new PracticeSlotNotificationService(supabase, emailService, realtimeService);
  }

  async runOnce(): Promise<void> {
    for (const transition of ['remind', 'close', 'complete'] as const) {
      const { data, error } = await this.supabase.rpc('practice_slots_scheduler_candidates', {
        p_transition: transition,
      });
      if (error) {
        throw error;
      }
      for (const candidate of data) {
        await this.processTransition(candidate, transition);
      }
    }
  }

  private async processTransition(candidate: Candidate, transition: SchedulerTransition): Promise<void> {
    // Solo un cupo liberado y vacío puede cerrarse a T-5.
    if (transition === 'close' && candidate.slot.status !== 'liberado') return;
    const { data, error } = await this.supabase.rpc('transition_practice_slot_for_scheduler', {
      p_slot_id: candidate.slot.id,
      p_transition: transition,
      p_expected_version: candidate.row_version,
    }).maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return; // Otro proceso cambió la fila o ya no cumple el plazo: sin efectos.
    }

    // La respuesta de la RPC confirma el commit antes de emitir efectos.
    if (transition === 'remind' && data.student_id !== null) {
      await this.notifications.remindStudent(data.student_id, data.scheduled_at);
    } else if (transition === 'close') {
      await this.notifications.notifyInstructorNoPractice(data.instructor_id, data.scheduled_at);
    }
    // Completar no registra asistencia ni emite notificaciones.
  }
}
