import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { CancelPracticeSlotInput, CancelPracticeSlotResult, CancellationPreview, PracticeSlot, ReleasedPracticeSlot, SwapPracticeResult } from '../models/practiceSlot.model';
import { throwAttendanceError } from '../utils/practiceAttendanceError';
import { throwPracticeWriteError } from '../utils/practiceSlotIntegrity';
import type { RealtimeService } from './realtime.service';
import { PracticeSlotNotificationService } from './practiceSlotNotification.service';

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
// mockearlos en tests. La cancelación tardía avisa por correo al instructor.
export class PracticeSlotActionService {
  private readonly notifications: PracticeSlotNotificationService;

  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly realtimeService: RealtimeService,
  ) {
    this.notifications = new PracticeSlotNotificationService(realtimeService);
  }

  // La RPC bloquea la fila, verifica la matrícula activa en la cohorte y
  // decide el plazo en el UPDATE con clock_timestamp() de PostgreSQL.
  async claimSlot(slotId: string, studentId: string): Promise<PracticeSlot> {
    return (await this.swapSlot(slotId, studentId)).slot;
  }

  async releasedForStudent(studentId: string): Promise<ReleasedPracticeSlot[]> {
    const { data, error } = await this.supabase.rpc('released_practice_slots_for_student', { p_student_id: studentId });
    if (error) throwPracticeWriteError(error);
    return data;
  }

  async pendingForStudent(studentId: string): Promise<{ slot: PracticeSlot; enrollmentId: string }[]> {
    const { data, error } = await this.supabase.rpc('pending_practice_slots_for_student', { p_student_id: studentId });
    if (error) throwPracticeWriteError(error);
    return data.map((item) => ({ ...item, slot: toPracticeSlot(item.slot) }));
  }

  async swapSlot(slotId: string, studentId: string, sourceSlotId?: string): Promise<SwapPracticeResult> {
    const { data, error } = await this.supabase.rpc('swap_practice_slot', {
      p_slot_id: slotId, p_student_id: studentId, p_source_slot_id: sourceSlotId ?? null,
    });
    if (error) throwPracticeWriteError(error);
    // RPC resuelta = commit confirmado. Los dos avisos son independientes y best-effort.
    // Nunca emitir slot-released por la franja de origen: evita la cascada de ofertas.
    await this.notifySwapSafely(`user-${studentId}-practice-slots`, 'slots-updated');
    await this.notifySwapSafely(`cohort-${data.slot.cohort_id}-practice-slots`, 'slot-taken');
    return { ...data, slot: toPracticeSlot(data.slot) };
  }

  private async notifySwapSafely(channel: string, event: string): Promise<void> {
    try { await this.realtimeService.broadcast(channel, event, {}); }
    catch (err) { console.error('No se pudo notificar el cambio de práctica:', err); }
  }

  async confirmSlot(slotId: string, studentId: string): Promise<PracticeSlot> {
    return this.actOnSlot(slotId, studentId, 'confirm');
  }

  async previewCancellation(slotId: string, studentId: string): Promise<CancellationPreview> {
    const { data, error } = await this.supabase.rpc('preview_practice_slot_cancellation', {
      p_slot_id: slotId, p_student_id: studentId,
    });
    if (error) throwPracticeWriteError(error);
    return data;
  }

  async cancelSlot(slotId: string, studentId: string, reason: CancelPracticeSlotInput): Promise<CancelPracticeSlotResult> {
    const { data, error } = await this.supabase.rpc('cancel_practice_slot_with_reason', {
      p_slot_id: slotId, p_student_id: studentId,
      p_motivo_categoria: reason.motivoCategoria, p_motivo_texto: reason.motivoTexto,
    });
    if (error) throwPracticeWriteError(error);
    const released = toPracticeSlot(data.slot);
    // El reloj y el umbral pertenecen a la transacción, no al reloj de Node.
    if (data.difundirCohorte) await this.notifyCohortSlotReleasedSafely(released);
    else await this.notifications.notifyInstructorNoPractice(data.instructorId, released.scheduledAt);
    return { ...released, cancelacion: {
      cancellationId: data.cancellationId, enrollmentId: data.enrollmentId,
      cancelledAt: data.cancelledAt, resultado: data.resultado,
      consumioReprogramacion: data.consumioReprogramacion,
      reprogramacionNumero: data.reprogramacionNumero,
      reprogramacionesRestantes: data.reprogramacionesRestantes,
    } };
  }

  private async actOnSlot(
    slotId: string, studentId: string, action: 'confirm',
  ): Promise<PracticeSlot> {
    const { data, error } = await this.supabase.rpc('act_on_practice_slot', {
      p_slot_id: slotId, p_student_id: studentId, p_action: action,
    }).single();
    if (error) {
      throwPracticeWriteError(error);
    }
    return toPracticeSlot(data);
  }

  // E4: la RPC guarda asistencia, auditoria y aviso juntos bajo lock.
  // Sin motivo es registro inicial; con motivo es correccion.
  async markAttendance(
    slotId: string,
    instructorId: string,
    attended: boolean,
    motivo?: string,
  ): Promise<PracticeSlot> {
    const args = { p_slot: slotId, p_actor: instructorId, p_attended: attended };
    const result = motivo === undefined
      ? this.supabase.rpc('register_practice_attendance', args)
      : this.supabase.rpc('correct_practice_attendance', { ...args, p_motivo: motivo });
    const { data, error } = await result.single();
    if (error) throwAttendanceError(error);
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
}
