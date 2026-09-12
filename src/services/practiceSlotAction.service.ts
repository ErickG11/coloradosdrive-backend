import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { PracticeSlot } from '../models/practiceSlot.model';
import { AppError } from '../utils/AppError';
import type { RealtimeService } from './realtime.service';

type PracticeSlotRow = Database['public']['Tables']['practice_slots']['Row'];

// RF-03: "la ventana de confirmación cierra 5 minutos antes de la práctica".
const CONFIRMATION_WINDOW_CLOSE_MINUTES = 5;

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

  // RF-03: reclamo atómico - el UPDATE trae su propia condición
  // (status IN ('disponible','liberado')) en vez de comprobar el estado
  // primero y actualizar después. Así, si dos estudiantes reclaman la
  // misma franja casi al mismo tiempo, solo el primero encuentra una fila
  // que matchea; el segundo no actualiza nada y recibe 409 - sin esto,
  // ambos "ganarían" la condición de carrera.
  async claimSlot(slotId: string, studentId: string): Promise<PracticeSlot> {
    const slotRow = await this.getSlotRowOrThrow(slotId);
    await this.assertStudentInCohort(studentId, slotRow.cohort_id);

    const { data, error } = await this.supabase
      .from('practice_slots')
      .update({ student_id: studentId, status: 'asignado' })
      .eq('id', slotId)
      .in('status', ['disponible', 'liberado'])
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('Esta franja ya no está disponible', 409);
    }

    return toPracticeSlot(data);
  }

  async confirmSlot(slotId: string, studentId: string): Promise<PracticeSlot> {
    const slotRow = await this.getOwnSlotOrThrow(slotId, studentId);
    if (slotRow.status !== 'asignado') {
      throw new AppError('Este turno no está pendiente de confirmación', 409);
    }
    if (this.isPastConfirmationWindowClose(slotRow.scheduled_at)) {
      throw new AppError('La ventana de confirmación ya cerró', 409);
    }

    const { data, error } = await this.supabase
      .from('practice_slots')
      .update({ status: 'confirmado', confirmed_at: new Date().toISOString() })
      .eq('id', slotId)
      .eq('status', 'asignado')
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('Este turno no está pendiente de confirmación', 409);
    }

    return toPracticeSlot(data);
  }

  // RF-03: cancelar libera el cupo y notifica a la cohorte por Realtime.
  // Se permite desde asignado o confirmado - el estudiante puede
  // cancelar incluso después de haber confirmado. Resetea confirmed_at/
  // confirmation_notified_at a NULL: si otro estudiante reclama esta
  // misma franja después, necesita su propio ciclo de confirmación, no
  // arrastrar el de quien canceló.
  async cancelSlot(slotId: string, studentId: string): Promise<PracticeSlot> {
    const slotRow = await this.getOwnSlotOrThrow(slotId, studentId);
    if (slotRow.status !== 'asignado' && slotRow.status !== 'confirmado') {
      throw new AppError('Este turno no se puede cancelar', 409);
    }

    const { data, error } = await this.supabase
      .from('practice_slots')
      .update({
        student_id: null,
        status: 'liberado',
        confirmed_at: null,
        confirmation_notified_at: null,
        release_notified_at: new Date().toISOString(),
      })
      .eq('id', slotId)
      .in('status', ['asignado', 'confirmado'])
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('Este turno no se puede cancelar', 409);
    }

    const released = toPracticeSlot(data);
    await this.notifyCohortSlotReleasedSafely(released);
    return released;
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

  private isPastConfirmationWindowClose(scheduledAt: string): boolean {
    const closeAt = new Date(scheduledAt).getTime() - CONFIRMATION_WINDOW_CLOSE_MINUTES * 60_000;
    return Date.now() > closeAt;
  }

  // RF-03: "solo los estudiantes de la misma cohorte pueden tomar un
  // cupo liberado" - se valida contra la inscripción activa, mismo
  // criterio que ExamAttemptService.assertStudentEnrolledInCourse.
  private async assertStudentInCohort(studentId: string, cohortId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('enrollments')
      .select('id')
      .eq('student_id', studentId)
      .eq('cohort_id', cohortId)
      .eq('status', 'activo')
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('No tienes una inscripción activa en la cohorte de esta franja', 403);
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

  private async getOwnSlotOrThrow(id: string, studentId: string): Promise<PracticeSlotRow> {
    const row = await this.getSlotRowOrThrow(id);
    if (row.student_id !== studentId) {
      throw new AppError('Franja no encontrada', 404);
    }
    return row;
  }
}
