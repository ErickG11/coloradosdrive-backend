export interface AttendanceEventRow extends Record<string, unknown> {
  id: string;
  slot_id: string;
  student_id: string;
  instructor_id: string;
  cohort_id: string;
  scheduled_at: string;
  duration_minutes: number;
  actor_id: string;
  actor_role: 'instructor' | 'admin';
  created_at: string;
  tipo: 'registro' | 'correccion';
  previous_attended: boolean | null;
  new_attended: boolean;
  motivo: string | null;
}

export interface AttendanceEvent {
  id: string;
  practiceSlotId: string;
  studentId: string;
  instructorId: string;
  cohortId: string;
  scheduledAt: string;
  durationMinutes: number;
  actorId: string;
  actorRole: 'instructor' | 'admin';
  createdAt: string;
  tipo: 'registro' | 'correccion';
  previousAttended: boolean | null;
  newAttended: boolean;
  motivo: string | null;
}

export interface PracticeHistoryRow {
  id: string;
  slot_id: string;
  cancellation_id: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  slot_status: string | null;
  attended: boolean | null;
  estado: 'asistio' | 'no_asistio' | 'pendiente' | 'liberada' | 'falta' | 'cancelada';
  resultado: 'reprogramable' | 'hora_perdida' | 'falta' | null;
  motivo: string | null;
}

export interface PracticeHistoryResult {
  items: PracticeHistoryRow[];
  total: number;
  summary: { horasAsistidas: number; horasObjetivo: number | null; horasPerdidas: number };
}

export interface AttendanceEventsPage {
  items: AttendanceEvent[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PracticeHistoryPage {
  enrollmentId: string;
  page: number;
  pageSize: number;
  total: number;
  summary: PracticeHistoryResult['summary'];
  items: {
    id: string;
    practiceSlotId: string;
    cancellationId: string | null;
    scheduledAt: string;
    durationMinutes: number | null;
    slotStatus: string | null;
    attended: boolean | null;
    estado: PracticeHistoryRow['estado'];
    resultado: PracticeHistoryRow['resultado'];
    motivo: string | null;
  }[];
}
export interface PracticeHistoryEnrollment {
  enrollmentId: string;
  cohortId: string | null;
  courseId: string;
  courseType: 'A' | 'B';
  status: 'activo' | 'finalizado' | 'retirado' | 'pendiente_cohorte';
  horasObjetivo: number | null;
}
