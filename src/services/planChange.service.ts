import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { cohortError, COHORT_ERRORS, type CohortErrorCode } from '../config/cohortErrors';
import type {
  StudentScheduleSelection,
  StudentScheduleReservation,
} from '../models/studentSchedule.model';
import type { PlanChangeState } from '../models/planChange.model';
import { summarizeSlots } from '../utils/studentFixedPlan';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { enrollmentRuleEnabled } from './enrollmentRuleFlags.service';
const inputJson = (input: StudentScheduleSelection) => ({
  modalidad: input.modalidad,
  fechaInicio: input.fechaInicio,
  horasPorDia: input.horasPorDia,
  horaInicio: input.horaInicio,
});
export const presentChangeReservation = (
  r: StudentScheduleReservation,
): StudentScheduleReservation => ({
  ...r,
  plan: summarizeSlots(r.franjas.map((f) => f.scheduledAt)),
});
export class PlanChangeService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  async state(student: string, enrollment: string, actor?: string): Promise<PlanChangeState> {
    if (!(await enrollmentRuleEnabled(this.db, 'schedule_changes')))
      return { active: false, serverNow: new Date().toISOString() };
    const result = actor
      ? await this.db.rpc('admin_plan_change_state_v2', {
          p_actor: actor,
          p_enrollment: enrollment,
        })
      : await this.db.rpc('student_plan_change_state_v2', {
          p_student: student,
          p_enrollment: enrollment,
        });
    if (result.error) throwStudentScheduleError(result.error);
    const state = result.data;
    if (actor && state.active && state.studentId !== student) throw cohortError('MATRICULA_AJENA');
    return {
      ...state,
      ...(state.reasonCode && state.reasonCode in COHORT_ERRORS
        ? { reason: COHORT_ERRORS[state.reasonCode as CohortErrorCode].student }
        : {}),
      reservation: state.reservation ? presentChangeReservation(state.reservation) : null,
    };
  }
  async preview(
    student: string,
    enrollment: string,
    input: StudentScheduleSelection,
    admin?: { id: string; reason: string; target?: string },
  ) {
    const result = admin
      ? await this.db.rpc('preview_admin_plan_change_v2', {
          p_actor: admin.id,
          p_enrollment: enrollment,
          p_input: inputJson(input),
          p_reason: admin.reason,
          p_target: admin.target ?? null,
        })
      : await this.db.rpc('preview_student_plan_change_v2', {
          p_student: student,
          p_enrollment: enrollment,
          p_input: inputJson(input),
        });
    if (result.error) throwStudentScheduleError(result.error);
    return { ...result.data, plan: summarizeSlots(result.data.franjas.map((f) => f.scheduledAt)) };
  }
  async calendar(
    student: string,
    enrollment: string,
    input: StudentScheduleSelection,
    admin?: { id: string; target?: string },
  ) {
    const result = admin
      ? await this.db.rpc('admin_plan_change_calendar_v2', {
          p_actor: admin.id,
          p_enrollment: enrollment,
          p_month: input.fechaInicio,
          p_mode: input.modalidad,
          p_hours: input.horasPorDia,
          p_target: admin.target ?? null,
        })
      : await this.db.rpc('student_plan_change_calendar_v2', {
          p_student: student,
          p_enrollment: enrollment,
          p_month: input.fechaInicio,
          p_mode: input.modalidad,
          p_hours: input.horasPorDia,
        });
    if (result.error) throwStudentScheduleError(result.error);
    return result.data;
  }
  async reserve(
    student: string,
    enrollment: string,
    input: StudentScheduleSelection,
    admin?: { id: string; reason: string; target?: string },
  ) {
    const result = admin
      ? await this.db.rpc('reserve_admin_plan_change_v2', {
          p_actor: admin.id,
          p_enrollment: enrollment,
          p_input: inputJson(input),
          p_reason: admin.reason,
          p_target: admin.target ?? null,
        })
      : await this.db.rpc('reserve_student_plan_change_v2', {
          p_student: student,
          p_enrollment: enrollment,
          p_input: inputJson(input),
        });
    if (result.error) throwStudentScheduleError(result.error);
    return presentChangeReservation(result.data);
  }
  async confirm(student: string, reservation: string, actor?: string) {
    const result = actor
      ? await this.db.rpc('confirm_admin_plan_change_v2', {
          p_actor: actor,
          p_reservation: reservation,
        })
      : await this.db.rpc('confirm_student_plan_change_v2', {
          p_student: student,
          p_reservation: reservation,
        });
    if (result.error) throwStudentScheduleError(result.error);
    return presentChangeReservation(result.data);
  }
}
