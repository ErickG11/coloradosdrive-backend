import type { AdminDashboardSummary } from '../models/adminDashboard.model';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import type { Database } from '../config/database.types';
import { AppError } from '../utils/AppError';
import { SCHOOL_TIMEZONE } from '../utils/schoolTimezone';

interface EnrollmentRow {
  id: string;
  student_id: string;
  course_type: 'A' | 'B';
  status: string;
  cohort_id: string | null;
  monto_total: string | null;
  monto_abonado: string;
  fecha_inscripcion: string;
  student: { nombre_completo: string; activo: boolean };
  cohort: { nombre: string } | null;
}
interface SlotRow {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  attended: boolean | null;
  student_id: string | null;
  student: { nombre_completo: string } | null;
  instructor: { nombre_completo: string } | null;
  cohort: { nombre: string } | null;
}
interface AttemptRow {
  id: string;
  student_id: string;
  status: string;
  passed: boolean | null;
  score_percent: string | null;
  started_at: string;
  completed_at: string | null;
}
interface DocumentRow {
  enrollment_id: string;
  tipo: string;
  estado: string;
}
interface Result<T> {
  data: T | null;
  error: string | null;
}
type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;

// Explicit paging prevents PostgREST's row cap from silently truncating totals.
// No student email, document URL, answers or payment credentials leave this service.
async function rows<T>(query: (from: number, to: number) => Page<T>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ;) {
    const page = await query(offset, offset + 499);
    if (page.error || !page.data) {
      console.warn(
        JSON.stringify({
          event: 'admin_dashboard_read_failed',
          code: page.error?.code ?? 'NO_DATA',
        }),
      );
      throw new AppError('No se pudo consultar el resumen', 503);
    }
    if (page.data.length === 0) return result;
    result.push(...page.data);
    offset += page.data.length;
  }
}
async function section<T>(name: string, work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { data: await work(), error: null };
  } catch {
    console.warn(JSON.stringify({ event: 'admin_dashboard_section_unavailable', section: name }));
    return { data: null, error: 'No pudimos cargar esta sección. Intenta actualizar el panel.' };
  }
}
const percentage = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
function utcIso(date: DateTime): string {
  const value = date.toUTC().toISO();
  if (!value) throw new AppError('Fecha inválida en el resumen', 503);
  return value;
}
function localDate(date: DateTime): string {
  const value = date.toISODate();
  if (!value) throw new AppError('Fecha inválida en el resumen', 503);
  return value;
}
const civilDay = (date: string): string =>
  localDate(DateTime.fromISO(date).setZone(SCHOOL_TIMEZONE));
const money = (value: number): number => Math.round(value * 100) / 100;

export class AdminDashboardService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async summary(monthInput?: string, dayInput?: string): Promise<AdminDashboardSummary> {
    const now = DateTime.fromJSDate(this.now(), { zone: SCHOOL_TIMEZONE });
    const month = monthInput ?? now.toFormat('yyyy-MM');
    const start = DateTime.fromISO(`${month}-01`, { zone: SCHOOL_TIMEZONE });
    if (
      !/^\d{4}-\d{2}$/.test(month) ||
      !start.isValid ||
      start.year < 2000 ||
      start > now.startOf('month')
    )
      throw new AppError('Selecciona un mes válido, desde 2000 hasta el mes actual', 400);
    const monthEnd = start.plus({ months: 1 });
    const end = monthEnd < now ? monthEnd : now;
    const day = dayInput ?? (start.hasSame(now, 'month') ? localDate(now) : localDate(start));
    const selectedDay = DateTime.fromISO(day, { zone: SCHOOL_TIMEZONE });
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !selectedDay.isValid ||
      !selectedDay.hasSame(start, 'month')
    )
      throw new AppError('El día debe pertenecer al mes seleccionado', 400);
    const previousStart = start.minus({ months: 1 });
    // An incomplete month compares to the same local elapsed time, never a full prior month.
    const previousEnd = start.hasSame(now, 'month')
      ? DateTime.min(
          start,
          previousStart.plus({ days: now.day - 1 }).set({
            hour: now.hour,
            minute: now.minute,
            second: now.second,
            millisecond: now.millisecond,
          }),
        )
      : start;
    const historyStart = start.minus({ months: 5 });
    const enrollmentSelect =
      'id,student_id,course_type,status,cohort_id,monto_total,monto_abonado,fecha_inscripcion,student:users!enrollments_student_id_fkey!inner(nombre_completo,activo),cohort:cohorts!enrollments_cohort_id_fkey(nombre)';
    const fetchEnrollments = (current: boolean): Promise<EnrollmentRow[]> =>
      rows<EnrollmentRow>((from, to) => {
        let query = this.db
          .from('enrollments')
          .select(enrollmentSelect)
          .eq('student.rol', 'estudiante');
        query = current
          ? query.in('status', ['activo', 'pendiente_cohorte'])
          : query
              .gte('fecha_inscripcion', utcIso(historyStart))
              .lt('fecha_inscripcion', utcIso(end));
        return query.order('id').range(from, to).overrideTypes<EnrollmentRow[], { merge: false }>();
      });
    let currentEnrollmentRows: Promise<EnrollmentRow[]> | undefined;
    const currentEnrollments = (): Promise<EnrollmentRow[]> =>
      (currentEnrollmentRows ??= fetchEnrollments(true));
    const documentsPromise = section('documents', async () => {
      // Match the existing alumnos documentosPendientes=true filter exactly.
      const [enrollments, docs] = await Promise.all([
        currentEnrollments(),
        rows<DocumentRow>((from, to) =>
          this.db
            .from('enrollment_documents')
            .select('enrollment_id,tipo,estado,enrollment:enrollments!inner(status)')
            .in('enrollment.status', ['activo', 'pendiente_cohorte'])
            .eq('estado', 'pendiente')
            .order('enrollment_id')
            .order('tipo')
            .range(from, to)
            .overrideTypes<DocumentRow[], { merge: false }>(),
        ),
      ]);
      const pending = new Set(docs.map((doc) => doc.enrollment_id));
      return {
        studentsPending: new Set(
          enrollments.filter((e) => e.student.activo && pending.has(e.id)).map((e) => e.student_id),
        ).size,
      };
    });
    const [current, activity, agenda, documents] = await Promise.all([
      section('current', async () => {
        const enrollments = await currentEnrollments();
        const active = enrollments.filter((e) => e.status === 'activo' && e.student.activo);
        const byStudent = new Map<string, Set<string>>();
        for (const e of active) {
          if (!byStudent.has(e.student_id)) byStudent.set(e.student_id, new Set());
          byStudent.get(e.student_id)?.add(e.course_type);
        }
        const distribution = [
          { key: 'B', label: 'Solo Tipo B', value: 0 },
          { key: 'A', label: 'Solo Tipo A', value: 0 },
          { key: 'both', label: 'Tipo A y B', value: 0 },
        ];
        for (const types of byStudent.values())
          distribution[types.size > 1 ? 2 : types.has('B') ? 0 : 1].value++;
        return {
          activeStudents: byStudent.size,
          balance: money(
            enrollments.reduce(
              (sum, e) =>
                sum +
                (e.monto_total === null
                  ? 0
                  : Math.max(0, Number(e.monto_total) - Number(e.monto_abonado))),
              0,
            ),
          ),
          unpricedEnrollments: enrollments.filter((e) => e.monto_total === null).length,
          pendingCohort: new Set(
            enrollments
              .filter((e) => e.status === 'pendiente_cohorte' && e.student.activo)
              .map((e) => e.student_id),
          ).size,
          distribution,
          enrollmentStates: ['activo', 'pendiente_cohorte'].map((status) => ({
            status,
            value: enrollments.filter((e) => e.status === status).length,
          })),
        };
      }),
      section('activity', async () => {
        const [enrollments, practices, attempts] = await Promise.all([
          fetchEnrollments(false),
          rows<SlotRow>((from, to) =>
            this.db
              .from('practice_slots')
              .select('id,scheduled_at,duration_minutes,status,attended,student_id')
              .gte('scheduled_at', utcIso(historyStart))
              .lt('scheduled_at', utcIso(end))
              .order('id')
              .range(from, to)
              .overrideTypes<SlotRow[], { merge: false }>(),
          ),
          rows<AttemptRow>((from, to) =>
            this.db
              .from('exam_attempts')
              .select('id,student_id,status,passed,score_percent,started_at,completed_at')
              .gte('started_at', utcIso(start))
              .lt('started_at', utcIso(end))
              .order('id')
              .range(from, to)
              .overrideTypes<AttemptRow[], { merge: false }>(),
          ),
        ]);
        const inWindow = (date: string, from: DateTime, to: DateTime): boolean => {
          const time = DateTime.fromISO(date).toMillis();
          return time >= from.toMillis() && time < to.toMillis();
        };
        const attended = practices.filter((s) => s.status === 'completado' && s.attended === true);
        const recent = enrollments.filter((e) => inWindow(e.fecha_inscripcion, start, end));
        const completed = attended.filter((s) => inWindow(s.scheduled_at, start, end));
        const previousEnrollments = enrollments.filter((e) =>
          inWindow(e.fecha_inscripcion, previousStart, previousEnd),
        ).length;
        const previousPractices = attended.filter((s) =>
          inWindow(s.scheduled_at, previousStart, previousEnd),
        ).length;
        const graded = attempts.filter(
          (a) => a.status === 'completado' && a.score_percent !== null,
        );
        return {
          newEnrollments: recent.length,
          completedPractices: completed.length,
          enrollmentTrend: percentage(recent.length, previousEnrollments),
          practiceTrend: percentage(completed.length, previousPractices),
          comparison: start.hasSame(now, 'month') ? 'Mismo tramo del mes anterior' : 'Mes anterior',
          series: Array.from({ length: 6 }, (_, i) => {
            const bucket = historyStart.plus({ months: i }).toFormat('yyyy-MM');
            return {
              month: bucket,
              enrollments: enrollments.filter((e) =>
                civilDay(e.fecha_inscripcion).startsWith(bucket),
              ).length,
              practices: attended.filter((s) => civilDay(s.scheduled_at).startsWith(bucket)).length,
            };
          }),
          recentEnrollments: recent
            .sort(
              (a, b) =>
                b.fecha_inscripcion.localeCompare(a.fecha_inscripcion) || a.id.localeCompare(b.id),
            )
            .slice(0, 5)
            .map((e) => ({
              id: e.id,
              studentId: e.student_id,
              name: e.student.nombre_completo,
              courseType: e.course_type,
              date: e.fecha_inscripcion,
              status: e.status,
              cohort: e.cohort?.nombre ?? null,
            })),
          academic: {
            studentsWithAttempts: new Set(attempts.map((a) => a.student_id)).size,
            completedAttempts: graded.length,
            passedAttempts: graded.filter((a) => a.passed).length,
            averageScore: graded.length
              ? Math.round(
                  (graded.reduce((sum, a) => sum + Number(a.score_percent), 0) / graded.length) *
                    10,
                ) / 10
              : null,
            practiceHours: money(completed.reduce((sum, s) => sum + s.duration_minutes, 0) / 60),
          },
        };
      }),
      section('agenda', async () => {
        const slots = await rows<SlotRow>((from, to) =>
          this.db
            .from('practice_slots')
            .select(
              'id,scheduled_at,duration_minutes,status,attended,student_id,student:users!practice_slots_student_id_fkey(nombre_completo),instructor:users!practice_slots_instructor_id_fkey(nombre_completo),cohort:cohorts(nombre)',
            )
            .gte('scheduled_at', utcIso(start))
            .lt('scheduled_at', utcIso(monthEnd))
            .in('status', ['asignado', 'confirmado', 'completado'])
            .order('id')
            .range(from, to)
            .overrideTypes<SlotRow[], { merge: false }>(),
        );
        const counts = new Map<string, number>();
        for (const slot of slots) {
          const date = civilDay(slot.scheduled_at);
          counts.set(date, (counts.get(date) ?? 0) + 1);
        }
        const selected = slots
          .filter((s) => civilDay(s.scheduled_at) === day)
          .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id));
        return {
          days: [...counts].map(([date, count]) => ({ date, count })),
          totalForDay: selected.length,
          slots: selected.slice(0, 12).map((s) => ({
            id: s.id,
            date: s.scheduled_at,
            duration: s.duration_minutes,
            status: s.status,
            studentId: s.student_id,
            student: s.student?.nombre_completo ?? 'Sin alumno',
            instructor: s.instructor?.nombre_completo ?? 'Instructor',
            cohort: s.cohort?.nombre ?? 'Cohorte',
          })),
        };
      }),
      documentsPromise,
    ]);

    return {
      generatedAt: utcIso(now),
      timezone: SCHOOL_TIMEZONE,
      month,
      day,
      period: { from: utcIso(start), to: utcIso(end), partial: start.hasSame(now, 'month') },
      current,
      activity,
      agenda,
      documents,
    };
  }
}
