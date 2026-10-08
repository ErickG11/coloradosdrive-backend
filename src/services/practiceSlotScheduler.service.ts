import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { EmailService } from './email.service';
import type { RealtimeService } from './realtime.service';

type SchedulerTransition = 'remind' | 'close' | 'complete';
type Candidate = Database['public']['Functions']['practice_slots_scheduler_candidates']['Returns'][number];

// PostgreSQL selecciona candidatos y decide estado/plazo de nuevo al escribir.
// El reloj de Node no participa en las decisiones (ADR 009).
export class PracticeSlotSchedulerService {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly emailService: EmailService,
    private readonly realtimeService: RealtimeService,
  ) {}

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
      await this.notifyStudentConfirmationRequestSafely(data.student_id, data.scheduled_at);
    } else if (transition === 'close') {
      // La versión aceptada garantiza que este era el estudiante al cerrar.
      if (candidate.slot.student_id !== null) {
        await this.broadcastToUserSafely(candidate.slot.student_id, 'no-practice', {
          scheduledAt: data.scheduled_at,
        });
      }
      await this.notifyInstructorNoPracticeSafely(data.instructor_id, data.scheduled_at);
    }
    // Completar no tiene notificación; se conserva el contrato de RF-03.
  }

  private async notifyStudentConfirmationRequestSafely(
    studentId: string,
    scheduledAt: string,
  ): Promise<void> {
    try {
      const { nombreCompleto, email } = await this.getUserContact(studentId);
      await this.emailService.sendPracticeConfirmationRequestEmail({
        to: email,
        nombreCompleto,
        scheduledAt,
      });
    } catch (err) {
      console.error('No se pudo enviar el correo de confirmación de práctica:', err);
    }

    await this.broadcastToUserSafely(studentId, 'confirmation-requested', { scheduledAt });
  }

  private async notifyInstructorNoPracticeSafely(
    instructorId: string,
    scheduledAt: string,
  ): Promise<void> {
    try {
      const { nombreCompleto, email } = await this.getUserContact(instructorId);
      await this.emailService.sendNoPracticeEmail({ to: email, nombreCompleto, scheduledAt });
    } catch (err) {
      console.error('No se pudo enviar el correo de sin-práctica al instructor:', err);
    }

    await this.broadcastToUserSafely(instructorId, 'no-practice', { scheduledAt });
  }

  private async broadcastToUserSafely(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.realtimeService.broadcast(`user-${userId}-practice-slots`, event, payload);
    } catch (err) {
      console.error(`No se pudo notificar (Realtime) el evento "${event}":`, err);
    }
  }

  private async getUserContact(userId: string): Promise<{ nombreCompleto: string; email: string }> {
    const { data: userRow, error: userError } = await this.supabase
      .from('users')
      .select('nombre_completo')
      .eq('id', userId)
      .maybeSingle();
    if (userError) {
      throw userError;
    }
    if (!userRow) {
      throw new Error('Usuario no encontrado');
    }

    const { data: authUser, error: authError } = await this.supabase.auth.admin.getUserById(userId);
    if (authError) {
      throw authError;
    }
    if (!authUser.user.email) {
      throw new Error('Correo del usuario no disponible');
    }

    return { nombreCompleto: userRow.nombre_completo, email: authUser.user.email };
  }
}
