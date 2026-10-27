import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type {
  AttendanceEvent,
  AttendanceEventRow,
  AttendanceEventsPage,
  PracticeHistoryPage,
  PracticeHistoryEnrollment,
} from '../models/practiceAttendance.model';
import { throwAttendanceError } from '../utils/practiceAttendanceError';

function eventDto(e: AttendanceEventRow): AttendanceEvent {
  return {
    id: e.id,
    practiceSlotId: e.slot_id,
    studentId: e.student_id,
    instructorId: e.instructor_id,
    cohortId: e.cohort_id,
    scheduledAt: e.scheduled_at,
    durationMinutes: e.duration_minutes,
    actorId: e.actor_id,
    actorRole: e.actor_role,
    createdAt: e.created_at,
    tipo: e.tipo,
    previousAttended: e.previous_attended,
    newAttended: e.new_attended,
    motivo: e.motivo,
  };
}

export class PracticeAttendanceService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  async events(
    actor: string,
    slot: string,
    page: number,
    pageSize: number,
  ): Promise<AttendanceEventsPage> {
    const { data, error } = await this.db.rpc('list_practice_attendance_events', {
      p_actor: actor,
      p_slot: slot,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throwAttendanceError(error);
    return { items: data.items.map(eventDto), total: data.total, page, pageSize };
  }
  async history(
    student: string,
    enrollment: string,
    page: number,
    pageSize: number,
  ): Promise<PracticeHistoryPage> {
    const { data, error } = await this.db.rpc('student_practice_history', {
      p_student: student,
      p_enrollment: enrollment,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throwAttendanceError(error);
    return {
      enrollmentId: enrollment,
      page,
      pageSize,
      total: data.total,
      summary: data.summary,
      items: data.items.map((item) => ({
        id: item.id,
        practiceSlotId: item.slot_id,
        cancellationId: item.cancellation_id,
        scheduledAt: item.scheduled_at,
        durationMinutes: item.duration_minutes,
        slotStatus: item.slot_status,
        attended: item.attended,
        estado: item.estado,
        resultado: item.resultado,
        motivo: item.motivo,
      })),
    };
  }
  async enrollments(student: string): Promise<PracticeHistoryEnrollment[]> {
    const { data, error } = await this.db
      .from('enrollments')
      .select('id,cohort_id,course_id,course_type,status,horas_practica_objetivo')
      .eq('student_id', student)
      .order('created_at', { ascending: false })
      .order('id');
    if (error) throwAttendanceError(error);
    return data.map((e) => ({
      enrollmentId: e.id,
      cohortId: e.cohort_id,
      courseId: e.course_id,
      courseType: e.course_type,
      status: e.status,
      horasObjetivo: e.horas_practica_objetivo,
    }));
  }
}
