import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { PracticeSlot } from '../models/practiceSlot.model';
import { AppError } from '../utils/AppError';
import { throwPracticeWriteError } from '../utils/practiceSlotIntegrity';
import type { RealtimeService } from './realtime.service';

type PracticeSlotRow = Database['public']['Tables']['practice_slots']['Row'];

function toPracticeSlot(row: PracticeSlotRow): PracticeSlot {
  return {
    id: row.id,
    cohortId: row.cohort_id,
    instructorId: row.instructor_id,
    studentId: row.student_id,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
    confirmationNotifiedAt: row.confirmation_notified_at,
    releaseNotifiedAt: row.release_notified_at,
    confirmedAt: row.confirmed_at,
    attended: row.attended,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Recibe el cliente de Supabase y el RealtimeService por constructor
// (mismo patrón que ExamAttemptService/EmailService) para poder
// mockearlos en tests. No depende de EmailService: ninguna de estas 3
// acciones envía correo (eso es exclusivo del scheduler, próximo commit).
export class PracticeSlotActionService {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly realtimeService: RealtimeService,
  ) {}

  // La RPC bloquea la fila, verifica la matrícula activa en la cohorte y
  // decide el plazo en el UPDATE con clock_timestamp() de PostgreSQL.
  async claimSlot(slotId: string, studentId: string): Promise<PracticeSlot> {
    return this.actOnSlot(slotId, studentId, 'claim');
  }

  async confirmSlot(slotId: string, studentId: string): Promise<PracticeSlot> {
    return this.actOnSlot(slotId, studentId, 'confirm');
  }

  // RF-03: cancelar libera el cupo y notifica a la cohorte por Realtime.
  // Se permite desde asignado o confirmado - el estudiante puede
  // cancelar incluso después de haber confirmado. Resetea confirmed_at/
  // confirmation_notified_at a NULL: si otro estudiante reclama esta
  // misma franja después, necesita su propio ciclo de confirmación, no
  // arrastrar el de quien canceló.
  async cancelSlot(slotId: string, studentId: string): Promise<PracticeSlot> {
    const released = await this.actOnSlot(slotId, studentId, 'cancel');
    await this.notifyCohortSlotReleasedSafely(released);
    return released;
  }

  private async actOnSlot(
    slotId: string, studentId: string, action: 'claim' | 'confirm' | 'cancel',
  ): Promise<PracticeSlot> {
    const { data, error } = await this.supabase.rpc('act_on_practice_slot', {
      p_slot_id: slotId, p_student_id: studentId, p_action: action,
    }).single();
    if (error) {
      throwPracticeWriteError(error);
    }
    return toPracticeSlot(data);
  }

  // Alcance agregado en Sprint 4 (ver docs/adr/007): el instructor
  // registra asistencia sobre sus propias franjas, solo una vez que ya
  // pasaron (status = 'completado' - lo marca el scheduler, próximo
  // commit). El documento de tesis todavía dice "solo lectura" para el
  // instructor; esto es un cambio de alcance consciente.
  async markAttendance(
    slotId: string,
    instructorId: string,
    attended: boolean,
  ): Promise<PracticeSlot> {
    const row = await this.getSlotRowOrThrow(slotId);
    if (row.instructor_id !== instructorId) {
      throw new AppError('Franja no encontrada', 404);
    }
    if (row.status !== 'completado') {
      throw new AppError('Solo se puede marcar asistencia sobre una franja completada', 409);
    }

    const { data, error } = await this.supabase
      .from('practice_slots')
      .update({ attended })
      .eq('id', slotId)
      .eq('status', 'completado')
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('Solo se puede marcar asistencia sobre una franja completada', 409);
    }

    return toPracticeSlot(data);
  }

  // Best-effort, mismo patrón que EnrollmentService con el correo de
  // bienvenida: si falla la notificación, no se revierte la liberación
  // del cupo (ya es válida), solo se loguea.
  private async notifyCohortSlotReleasedSafely(slot: PracticeSlot): Promise<void> {
    try {
      await this.realtimeService.broadcast(
        `cohort-${slot.cohortId}-practice-slots`,
        'slot-released',
        { slotId: slot.id, scheduledAt: slot.scheduledAt },
      );
    } catch (err) {
      console.error('No se pudo notificar la liberación del cupo:', err);
    }
  }

  private async getSlotRowOrThrow(id: string): Promise<PracticeSlotRow> {
    const { data, error } = await this.supabase
      .from('practice_slots')
      .select()
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('Franja no encontrada', 404);
    }
    return data;
  }
}
