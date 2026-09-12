import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type {
  CreatePracticeSlotInput,
  PracticeSlot,
  PracticeSlotStatus,
  UpdatePracticeSlotInput,
} from '../models/practiceSlot.model';
import { AppError } from '../utils/AppError';

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

export interface AdminSlotFilters {
  cohortId?: string;
  instructorId?: string;
  status?: PracticeSlotStatus;
}

// Recibe el cliente de Supabase por constructor para poder mockearlo en
// tests (mismo patrón que CohortService/ExamService). Las acciones del
// estudiante (reclamar/confirmar/cancelar) y del instructor (marcar
// asistencia) viven en PracticeSlotActionService (próximos commits) -
// esta clase es CRUD de administrador + las 3 variantes de listado.
export class PracticeSlotService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async createSlot(input: CreatePracticeSlotInput): Promise<PracticeSlot> {
    await this.assertCohortExists(input.cohortId);
    await this.assertInstructorExists(input.instructorId);

    const { data, error } = await this.supabase
      .from('practice_slots')
      .insert({
        cohort_id: input.cohortId,
        instructor_id: input.instructorId,
        scheduled_at: input.scheduledAt,
        duration_minutes: input.durationMinutes,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return toPracticeSlot(data);
  }

  async listSlotsForAdmin(filters: AdminSlotFilters): Promise<PracticeSlot[]> {
    let query = this.supabase.from('practice_slots').select().order('scheduled_at', {
      ascending: true,
    });
    if (filters.cohortId !== undefined) {
      query = query.eq('cohort_id', filters.cohortId);
    }
    if (filters.instructorId !== undefined) {
      query = query.eq('instructor_id', filters.instructorId);
    }
    if (filters.status !== undefined) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return data.map(toPracticeSlot);
  }

  // RF-03: el estudiante ve las franjas disponibles de su propia cohorte
  // (vía su inscripción activa), más sus propias franjas ya asignadas/
  // confirmadas aunque ya no estén "disponibles". studentId siempre viene
  // del JWT ya verificado (ver practiceSlot.controller.ts), nunca de un
  // parámetro del cliente, así que interpolarlo en el filtro .or() es
  // seguro (un UUID de sesión, no un valor arbitrario del request).
  async listSlotsForStudent(studentId: string): Promise<PracticeSlot[]> {
    const cohortId = await this.getActiveCohortIdForStudent(studentId);
    if (!cohortId) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('practice_slots')
      .select()
      .eq('cohort_id', cohortId)
      .or(`status.eq.disponible,student_id.eq.${studentId}`)
      .order('scheduled_at', { ascending: true });

    if (error) {
      throw error;
    }

    return data.map(toPracticeSlot);
  }

  // RF-03: "acceso de solo lectura a su disponibilidad semanal y a los
  // estudiantes asignados" - todas sus franjas, en cualquier estado, no
  // solo asignado/confirmado.
  async listSlotsForInstructor(instructorId: string): Promise<PracticeSlot[]> {
    const { data, error } = await this.supabase
      .from('practice_slots')
      .select()
      .eq('instructor_id', instructorId)
      .order('scheduled_at', { ascending: true });

    if (error) {
      throw error;
    }

    return data.map(toPracticeSlot);
  }

  // Editar solo se permite si status = 'disponible' (confirmado
  // explícitamente contigo): cambiar instructor/horario/duración de una
  // franja ya reclamada afectaría a un estudiante ya comprometido sin que
  // nadie se lo avise. La condición va en el propio UPDATE (no
  // check-then-act) para no perder una condición de carrera contra un
  // reclamo simultáneo.
  async updateSlot(id: string, input: UpdatePracticeSlotInput): Promise<PracticeSlot> {
    if (input.instructorId !== undefined) {
      await this.assertInstructorExists(input.instructorId);
    }

    const updatePayload: Database['public']['Tables']['practice_slots']['Update'] = {};
    if (input.instructorId !== undefined) updatePayload.instructor_id = input.instructorId;
    if (input.scheduledAt !== undefined) updatePayload.scheduled_at = input.scheduledAt;
    if (input.durationMinutes !== undefined) updatePayload.duration_minutes = input.durationMinutes;

    const { data, error } = await this.supabase
      .from('practice_slots')
      .update(updatePayload)
      .eq('id', id)
      .eq('status', 'disponible')
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      await this.getSlotRowOrThrow(id);
      throw new AppError('Solo se puede editar una franja disponible (sin reclamar)', 409);
    }

    return toPracticeSlot(data);
  }

  async deleteSlot(id: string): Promise<void> {
    const { error, count } = await this.supabase
      .from('practice_slots')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('status', 'disponible');

    if (error) {
      throw error;
    }
    if (!count) {
      await this.getSlotRowOrThrow(id);
      throw new AppError('Solo se puede eliminar una franja disponible (sin reclamar)', 409);
    }
  }

  private async assertCohortExists(cohortId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('cohorts')
      .select('id')
      .eq('id', cohortId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('La cohorte indicada no existe', 404);
    }
  }

  private async assertInstructorExists(instructorId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, rol')
      .eq('id', instructorId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('El instructor indicado no existe', 404);
    }
    if (data.rol !== 'instructor') {
      throw new AppError('El usuario indicado no tiene rol instructor', 400);
    }
  }

  private async getActiveCohortIdForStudent(studentId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('enrollments')
      .select('cohort_id')
      .eq('student_id', studentId)
      .eq('status', 'activo')
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? data.cohort_id : null;
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

export { toPracticeSlot };
