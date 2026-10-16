import type { Database } from '../config/database.types';
import { DOCUMENT_TYPES } from '../utils/manualEnrollmentDetails';

type Enrollment = Pick<
  Database['public']['Tables']['enrollments']['Row'],
  | 'id'
  | 'student_id'
  | 'course_id'
  | 'cohort_id'
  | 'status'
  | 'monto_total'
  | 'monto_abonado'
  | 'horas_practica_objetivo'
>;
type Document = Pick<
  Database['public']['Tables']['enrollment_documents']['Row'],
  'enrollment_id' | 'tipo' | 'estado'
>;
type Exam = Pick<Database['public']['Tables']['exams']['Row'], 'id' | 'course_id'>;
type Attempt = Pick<
  Database['public']['Tables']['exam_attempts']['Row'],
  'exam_id' | 'status' | 'passed'
>;
export type StudentSlot = Pick<
  Database['public']['Tables']['practice_slots']['Row'],
  'id' | 'cohort_id' | 'instructor_id' | 'scheduled_at' | 'duration_minutes' | 'status' | 'attended'
>;
export type StudentRecovery = Pick<
  Database['public']['Tables']['student_practice_recovery']['Row'],
  'slot_id' | 'cohort_id' | 'instructor_id' | 'scheduled_at' | 'status' | 'reason'
>;
export interface GraduationCheck {
  key: 'cohort' | 'payments' | 'practice' | 'exams' | 'documents';
  label: string;
  fulfilled: boolean;
  detail: string;
}
export interface StudentGraduation {
  pendingCount: number | null;
  enrollments: { enrollmentId: string; courseName: string; checks: GraduationCheck[] }[];
}
export interface StudentPractice {
  id: string;
  scheduledAt: string;
  durationMinutes: number | null;
  instructor: string | null;
  status:
    | 'reservada'
    | 'confirmada'
    | 'liberada'
    | 'pendiente_reprogramar'
    | 'completada'
    | 'sin_practica';
  attended: boolean | null;
  reason: string | null;
}
export interface StudentSchedule {
  upcoming: StudentPractice[];
  recovery: StudentPractice[];
  recent: StudentPractice[];
}
const documentNames: Record<string, string> = {
  cedula: 'cédula',
  papeleta_votacion: 'papeleta de votación',
  tipo_sangre: 'tipo de sangre',
  titulo_bachiller: 'título de bachiller',
};
const money = (value: number): string => '$' + value.toFixed(2);
export function studentGraduation(
  enrollments: Enrollment[],
  documents: Document[],
  courses: { id: string; nombre: string }[],
  exams: Exam[],
  attempts: Attempt[],
  slots: StudentSlot[],
): StudentGraduation {
  const current = enrollments.filter(
    (e) => e.status === 'activo' || e.status === 'pendiente_cohorte',
  );
  const result = current.map((e) => {
    const missing = DOCUMENT_TYPES.filter(
      (tipo) =>
        !documents.some(
          (d) =>
            d.enrollment_id === e.id &&
            d.tipo === tipo &&
            ['entregado', 'no_aplica'].includes(d.estado),
        ),
    );
    const balance =
      e.monto_total === null
        ? null
        : Math.round((Number(e.monto_total) - Number(e.monto_abonado)) * 100) / 100;
    const finals = exams.filter((x) => x.course_id === e.course_id);
    const approved = finals.filter((x) =>
      attempts.some((a) => a.exam_id === x.id && a.status === 'completado' && a.passed),
    ).length;
    const minutes = slots
      .filter(
        (s) => s.cohort_id === e.cohort_id && s.status === 'completado' && s.attended === true,
      )
      .reduce((sum, s) => sum + s.duration_minutes, 0);
    const hours = Math.round((minutes / 60) * 100) / 100;
    const target = e.horas_practica_objetivo;
    const checks: GraduationCheck[] = [
      {
        key: 'cohort',
        label: 'Cohorte',
        fulfilled: e.cohort_id !== null,
        detail: e.cohort_id ? 'Cohorte asignada' : 'Sin cohorte asignada',
      },
      {
        key: 'payments',
        label: 'Pagos',
        fulfilled: balance !== null && balance <= 0,
        detail:
          balance === null
            ? 'Total aún no definido; abonado ' + money(Number(e.monto_abonado))
            : balance > 0
              ? 'Saldo pendiente ' + money(balance) + '; abonado ' + money(Number(e.monto_abonado))
              : 'Saldo pendiente ' + money(0) + '; pago completo',
      },
      {
        key: 'practice',
        label: 'Práctica',
        fulfilled: target !== null && minutes >= target * 60,
        detail:
          target === null
            ? String(hours) + ' horas cumplidas; objetivo sin registrar'
            : String(hours) + ' de ' + String(target) + ' horas',
      },
      {
        key: 'exams',
        label: 'Exámenes definitivos',
        fulfilled: finals.length > 0 && approved === finals.length,
        detail: finals.length
          ? String(approved) + ' de ' + String(finals.length) + ' aprobados'
          : 'Sin exámenes definitivos publicados',
      },
      {
        key: 'documents',
        label: 'Documentos',
        fulfilled: missing.length === 0,
        detail: missing.length
          ? 'Falta: ' + missing.map((tipo) => documentNames[tipo]).join(', ')
          : 'Documentos entregados o no aplicables',
      },
    ];
    return {
      enrollmentId: e.id,
      courseName: courses.find((c) => c.id === e.course_id)?.nombre ?? 'Curso no disponible',
      checks: checks.sort((a, b) => Number(a.fulfilled) - Number(b.fulfilled)),
    };
  });
  return {
    pendingCount: result.length
      ? result.reduce((sum, e) => sum + e.checks.filter((c) => !c.fulfilled).length, 0)
      : null,
    enrollments: result,
  };
}
export function studentSchedule(
  slots: StudentSlot[],
  recovery: StudentRecovery[],
  instructors: { id: string; nombre_completo: string }[],
  now: Date,
): StudentSchedule {
  const name = (id: string): string | null =>
    instructors.find((i) => i.id === id)?.nombre_completo ?? null;
  const states: Record<StudentSlot['status'], StudentPractice['status']> = {
    asignado: 'reservada',
    confirmado: 'confirmada',
    completado: 'completada',
    liberado: 'liberada',
    sin_practica: 'sin_practica',
    disponible: 'liberada',
  };
  const rows: StudentPractice[] = slots.map((s) => ({
    id: s.id,
    scheduledAt: s.scheduled_at,
    durationMinutes: s.duration_minutes,
    instructor: name(s.instructor_id),
    status: states[s.status],
    attended: s.attended,
    reason: null,
  }));
  const pending: StudentPractice[] = recovery
    .filter(
      (r) =>
        !slots.some(
          (s) =>
            s.id === r.slot_id &&
            s.scheduled_at === r.scheduled_at &&
            s.instructor_id === r.instructor_id &&
            s.cohort_id === r.cohort_id &&
            ['asignado', 'confirmado', 'completado'].includes(s.status),
        ),
    )
    .map((r) => ({
      id: r.slot_id,
      scheduledAt: r.scheduled_at,
      durationMinutes: null,
      instructor: name(r.instructor_id),
      status: r.status === 'cancelada_por_desactivacion' ? 'liberada' : 'pendiente_reprogramar',
      attended: null,
      reason: r.reason,
    }));
  const ascending = (a: StudentPractice, b: StudentPractice): number =>
    Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.id.localeCompare(b.id);
  return {
    upcoming: rows
      .filter(
        (r) =>
          Date.parse(r.scheduledAt) >= now.getTime() &&
          ['reservada', 'confirmada'].includes(r.status),
      )
      .sort(ascending),
    recovery: pending.sort(ascending),
    recent: rows
      .filter(
        (r) =>
          Date.parse(r.scheduledAt) < now.getTime() ||
          !['reservada', 'confirmada'].includes(r.status),
      )
      .sort((a, b) => ascending(b, a))
      .slice(0, 10),
  };
}
