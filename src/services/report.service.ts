import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import type { Database } from '../config/database.types';
import {
  COURSE_TYPE_FILTERS,
  REPORT_SELECTIONS,
  REPORT_TYPES,
  type CourseTypeFilter,
  type ReportActor,
  type ReportCell,
  type ReportColumn,
  type ReportDocument,
  type ReportFilters,
  type ReportSelection,
  type ReportTable,
  type ReportType,
} from '../models/report.model';
import { AppError } from '../utils/AppError';
import { dollarsToCentavos, ratio, safeSheetName } from '../utils/reportFormat';
import { logSafeError } from '../utils/safeLog';
import { SCHOOL_TIMEZONE } from '../utils/schoolTimezone';

// RF-08 · Servicio de reportes (CD-346, base de CD-345). Una función por tipo
// de reporte; todas devuelven la misma estructura neutral. Agrega en memoria
// sobre lecturas paginadas (igual que el resumen administrativo de CD-265):
// con ~200 usuarios el volumen es de cientos a pocos miles de filas y evita
// una migración. No sale de aquí ningún dato personal de alumnos: solo
// agregados y, en el ranking, nombres de instructores.

/** Rango máximo consultable, en días civiles (un año, incluido el bisiesto). */
export const REPORT_MAX_RANGE_DAYS = 366;
/** Tope de filas leídas por consulta; superarlo pide acotar los filtros (413). */
export const REPORT_MAX_SOURCE_ROWS = 20_000;
/** Tope de filas presentadas por reporte (413). */
export const REPORT_MAX_ROWS = 2_000;
export const REPORT_MIN_DATE = '2000-01-01';
/** Mínimo de calificaciones para entrar al ranking (misma regla que RF-04). */
export const RANKING_MIN_RESPONSES = 3;
const PAGE_SIZE = 1000;
const SCHOOL_NAME = 'ColoradosDrive · Escuela de conducción';
const NO_COHORT = 'Sin cohorte';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REPORT_TITLES: Record<ReportType, string> = {
  matriculas: 'Matrículas por cohorte',
  asistencia: 'Asistencia a prácticas',
  examenes: 'Aprobación de exámenes',
  finanzas: 'Finanzas',
  instructores: 'Ranking de instructores',
};

type CourseType = 'A' | 'B';
interface CohortInfo {
  nombre: string;
  tipo: CourseType | null;
  courseId: string;
}
interface Catalog {
  cohorts: Map<string, CohortInfo>;
  courseTypes: Map<string, CourseType>;
}
interface Period {
  from: DateTime;
  /** Exclusivo: 00:00 del día siguiente a `hasta`, hora de Ecuador. */
  to: DateTime;
  fromIso: string;
  toIso: string;
}
type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;

function invalid(message: string, field: string): AppError {
  return new AppError(message, 400, { code: 'INVALID_FIELD', field });
}

function civilDate(value: unknown, field: 'desde' | 'hasta'): DateTime {
  const label = field === 'desde' ? 'La fecha inicial' : 'La fecha final';
  if (typeof value !== 'string' || !DATE_RE.test(value))
    throw invalid(`${label} debe tener el formato AAAA-MM-DD`, field);
  const date = DateTime.fromISO(value, { zone: SCHOOL_TIMEZONE });
  if (!date.isValid) throw invalid(`${label} no es una fecha válida`, field);
  if (value < REPORT_MIN_DATE) throw invalid(`${label} no puede ser anterior al año 2000`, field);
  return date.startOf('day');
}

/**
 * Valida y normaliza los filtros. Es la autoridad del servidor: se ejecuta
 * siempre, aunque la ruta ya haya pasado por express-validator.
 */
export function parseReportFilters(raw: Record<string, unknown>): ReportFilters {
  const desde = civilDate(raw.desde, 'desde');
  const hasta = civilDate(raw.hasta, 'hasta');
  if (desde > hasta)
    throw invalid('La fecha inicial no puede ser posterior a la fecha final', 'desde');
  if (hasta.diff(desde, 'days').days + 1 > REPORT_MAX_RANGE_DAYS)
    throw invalid(
      `El período no puede superar ${String(REPORT_MAX_RANGE_DAYS)} días. Acota las fechas.`,
      'hasta',
    );
  const tipoCurso = raw.tipoCurso ?? 'todos';
  if (!COURSE_TYPE_FILTERS.includes(tipoCurso as CourseTypeFilter))
    throw invalid('El tipo de curso debe ser A, B o todos', 'tipoCurso');
  const tipo = raw.tipo ?? 'todos';
  if (!REPORT_SELECTIONS.includes(tipo as ReportSelection))
    throw invalid('El tipo de reporte no es válido', 'tipo');
  const cohorteRaw = raw.cohorteId;
  let cohorteId: string | null = null;
  if (cohorteRaw !== undefined && cohorteRaw !== null && cohorteRaw !== '') {
    if (typeof cohorteRaw !== 'string' || !UUID_RE.test(cohorteRaw))
      throw invalid('La cohorte seleccionada no es válida', 'cohorteId');
    cohorteId = cohorteRaw.toLowerCase();
  }
  return {
    desde: raw.desde as string,
    hasta: raw.hasta as string,
    tipoCurso: tipoCurso as CourseTypeFilter,
    cohorteId,
    tipo: tipo as ReportSelection,
  };
}

/** Límites del período en hora de Ecuador: [desde 00:00:00, hasta 23:59:59.999]. */
export function reportPeriod(desde: string, hasta: string): Period {
  const from = DateTime.fromISO(desde, { zone: SCHOOL_TIMEZONE }).startOf('day');
  const to = DateTime.fromISO(hasta, { zone: SCHOOL_TIMEZONE }).startOf('day').plus({ days: 1 });
  const fromIso = from.toUTC().toISO();
  const toIso = to.toUTC().toISO();
  if (!from.isValid || !to.isValid || !fromIso || !toIso)
    throw new AppError('El período seleccionado no es válido', 400, { code: 'INVALID_FIELD' });
  return { from, to, fromIso, toIso };
}

function inPeriod(instant: string | null | undefined, period: Period): boolean {
  if (!instant) return false;
  const millis = DateTime.fromISO(instant, { setZone: true }).toMillis();
  return (
    Number.isFinite(millis) && millis >= period.from.toMillis() && millis < period.to.toMillis()
  );
}

const typeLabel = (tipo: CourseType | null): string => (tipo ? `Tipo ${tipo}` : 'Sin tipo');
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const byText = (a: string, b: string): number => a.localeCompare(b, 'es', { sensitivity: 'base' });

/** Quita las claves auxiliares (prefijo _) que solo sirven para calcular totales. */
function publicRow(row: Record<string, unknown>): Record<string, ReportCell> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_'))) as Record<
    string,
    ReportCell
  >;
}

function formatCivil(date: string): string {
  return DateTime.fromISO(date, { zone: SCHOOL_TIMEZONE }).toFormat('dd/MM/yyyy');
}

interface Group {
  cohortId: string | null;
  tipo: CourseType | null;
}

export class ReportService {
  // Varias tablas de reportes (payments, practice_ratings) no tienen tipado de
  // escritura en database.types; las lecturas se tipan fila a fila aquí.
  private readonly db: SupabaseClient;

  constructor(
    db: SupabaseClient<Database>,
    private readonly now: () => Date = () => new Date(),
    private readonly demoMode = false,
  ) {
    this.db = db;
  }

  /** Lectura paginada con tope: PostgREST nunca trunca en silencio un total. */
  private async rows<T>(name: string, query: (from: number, to: number) => Page<T>): Promise<T[]> {
    const result: T[] = [];
    for (let offset = 0; ;) {
      const page = await query(offset, offset + PAGE_SIZE - 1);
      if (page.error || !page.data) {
        logSafeError(`report_read_failed_${name}`, page.error ?? undefined);
        throw new AppError('No se pudo consultar los datos del reporte. Intenta de nuevo.', 503, {
          code: 'REPORTE_NO_DISPONIBLE',
        });
      }
      if (page.data.length === 0) return result;
      result.push(...page.data);
      if (result.length > REPORT_MAX_SOURCE_ROWS)
        throw new AppError(
          'El reporte supera el volumen permitido. Acota el rango de fechas o elige una cohorte.',
          413,
          { code: 'REPORTE_DEMASIADOS_DATOS' },
        );
      offset += page.data.length;
    }
  }

  private async catalog(): Promise<Catalog> {
    const [courses, cohorts] = await Promise.all([
      this.rows<{ id: string; tipo: CourseType }>('courses', (from, to) =>
        this.db.from('courses').select('id,tipo').order('id').range(from, to),
      ),
      this.rows<{ id: string; nombre: string; course_id: string }>('cohorts', (from, to) =>
        this.db.from('cohorts').select('id,nombre,course_id').order('id').range(from, to),
      ),
    ]);
    const courseTypes = new Map(courses.map((course) => [course.id, course.tipo]));
    return {
      courseTypes,
      cohorts: new Map(
        cohorts.map((cohort) => [
          cohort.id,
          {
            nombre: cohort.nombre,
            tipo: courseTypes.get(cohort.course_id) ?? null,
            courseId: cohort.course_id,
          },
        ]),
      ),
    };
  }

  private async actorName(actorId: string): Promise<string> {
    const { data, error } = await this.db
      .from('users')
      .select('nombre_completo')
      .eq('id', actorId)
      .maybeSingle<{ nombre_completo: string }>();
    if (error) logSafeError('report_actor_read_failed', error);
    const name = data?.nombre_completo.trim();
    if (!name) return 'Administrador';
    return name;
  }

  async build(input: ReportFilters, actor: ReportActor): Promise<ReportDocument> {
    const filters = parseReportFilters({ ...input });
    const period = reportPeriod(filters.desde, filters.hasta);
    const [catalog, name] = await Promise.all([this.catalog(), this.actorName(actor.id)]);

    let cohortName: string | null = null;
    if (filters.cohorteId) {
      const cohort = catalog.cohorts.get(filters.cohorteId);
      if (!cohort)
        throw new AppError('La cohorte seleccionada no existe', 400, {
          code: 'COHORTE_NO_ENCONTRADA',
          field: 'cohorteId',
        });
      if (filters.tipoCurso !== 'todos' && cohort.tipo !== filters.tipoCurso)
        throw new AppError(
          `La cohorte seleccionada no pertenece al curso tipo ${filters.tipoCurso}`,
          400,
          { code: 'COHORTE_TIPO_INCOHERENTE', field: 'cohorteId' },
        );
      cohortName = cohort.nombre;
    }

    if (filters.tipo === 'finanzas' && !actor.canViewFinance)
      throw new AppError('No tienes permiso para consultar reportes financieros', 403, {
        code: 'PERMISO_REQUERIDO',
      });

    const requested: ReportType[] = filters.tipo === 'todos' ? [...REPORT_TYPES] : [filters.tipo];
    const omitted: ReportDocument['meta']['omitted'] = [];
    const allowed = requested.filter((type) => {
      if (type !== 'finanzas' || actor.canViewFinance) return true;
      omitted.push({
        type,
        reason: 'Finanzas: reservado al permiso de pagos y facturas.',
      });
      return false;
    });

    const builders: Record<ReportType, () => Promise<ReportTable>> = {
      matriculas: () => this.matriculas(filters, period, catalog),
      asistencia: () => this.asistencia(filters, period, catalog),
      examenes: () => this.examenes(filters, period, catalog),
      finanzas: () => this.finanzas(filters, period, catalog),
      instructores: () => this.instructores(filters, period, catalog),
    };
    const reports = await Promise.all(allowed.map((type) => builders[type]()));
    const used = new Set<string>();
    for (const report of reports) {
      if (report.rowCount > REPORT_MAX_ROWS)
        throw new AppError(
          'El reporte tiene demasiadas filas. Acota el rango de fechas o elige una cohorte.',
          413,
          { code: 'REPORTE_DEMASIADOS_DATOS' },
        );
      report.sheetName = safeSheetName(report.title, used);
      used.add(report.sheetName);
    }

    const generatedAt = DateTime.fromJSDate(this.now(), { zone: SCHOOL_TIMEZONE });
    return {
      meta: {
        school: SCHOOL_NAME,
        title:
          filters.tipo === 'todos' ? 'Reporte general de la escuela' : REPORT_TITLES[filters.tipo],
        generatedAt: generatedAt.toISO() ?? '',
        timezone: SCHOOL_TIMEZONE,
        generatedBy: { name, role: 'Administrador' },
        filters,
        filterSummary: [
          {
            label: 'Período',
            value: `${formatCivil(filters.desde)} al ${formatCivil(filters.hasta)} (hora de Ecuador)`,
          },
          {
            label: 'Tipo de curso',
            value: filters.tipoCurso === 'todos' ? 'Todos' : `Tipo ${filters.tipoCurso}`,
          },
          { label: 'Cohorte', value: cohortName ?? 'Todas' },
          {
            label: 'Reporte',
            value: filters.tipo === 'todos' ? 'Todos' : REPORT_TITLES[filters.tipo],
          },
        ],
        demoMode: this.demoMode,
        omitted,
      },
      reports,
    };
  }

  private matches(filters: ReportFilters, group: Group): boolean {
    if (filters.cohorteId && group.cohortId !== filters.cohorteId) return false;
    if (filters.tipoCurso !== 'todos' && group.tipo !== filters.tipoCurso) return false;
    return true;
  }

  private groupLabels(group: Group, catalog: Catalog): { cohorte: string; tipoCurso: string } {
    return {
      cohorte: group.cohortId
        ? (catalog.cohorts.get(group.cohortId)?.nombre ?? 'Cohorte eliminada')
        : NO_COHORT,
      tipoCurso: typeLabel(group.tipo),
    };
  }

  private table(
    type: ReportType,
    description: string,
    columns: ReportColumn[],
    rows: Record<string, ReportCell>[],
    extra: Pick<ReportTable, 'totals' | 'indicators' | 'notes' | 'chart'>,
  ): ReportTable {
    return {
      type,
      title: REPORT_TITLES[type],
      sheetName: REPORT_TITLES[type],
      description,
      columns,
      rows,
      ...extra,
      totals: rows.length ? extra.totals : null,
      chart: rows.length && extra.chart?.items.length ? extra.chart : null,
      rowCount: rows.length,
    };
  }

  // (1) Matrículas por cohorte, tipo de curso y estado. Fecha que cuenta: fecha de inscripción.
  private async matriculas(
    f: ReportFilters,
    period: Period,
    catalog: Catalog,
  ): Promise<ReportTable> {
    interface Row {
      id: string;
      course_type: CourseType;
      status: string;
      cohort_id: string | null;
      fecha_inscripcion: string;
    }
    const data = await this.rows<Row>('enrollments', (from, to) => {
      let query = this.db
        .from('enrollments')
        .select('id,course_type,status,cohort_id,fecha_inscripcion')
        .gte('fecha_inscripcion', period.fromIso)
        .lt('fecha_inscripcion', period.toIso);
      if (f.cohorteId) query = query.eq('cohort_id', f.cohorteId);
      if (f.tipoCurso !== 'todos') query = query.eq('course_type', f.tipoCurso);
      return query.order('id').range(from, to);
    });
    const states = ['activo', 'pendiente_cohorte', 'finalizado', 'retirado', 'anulada'] as const;
    const groups = new Map<string, Group & Record<(typeof states)[number], number>>();
    for (const row of data) {
      const group: Group = { cohortId: row.cohort_id, tipo: row.course_type };
      if (!inPeriod(row.fecha_inscripcion, period) || !this.matches(f, group)) continue;
      const key = `${group.cohortId ?? ''}|${group.tipo ?? ''}`;
      const entry = groups.get(key) ?? {
        ...group,
        activo: 0,
        pendiente_cohorte: 0,
        finalizado: 0,
        retirado: 0,
        anulada: 0,
      };
      if ((states as readonly string[]).includes(row.status))
        entry[row.status as (typeof states)[number]] += 1;
      groups.set(key, entry);
    }
    const rows = [...groups.values()]
      .map((g) => ({
        ...this.groupLabels(g, catalog),
        activas: g.activo,
        pendientes: g.pendiente_cohorte,
        finalizadas: g.finalizado,
        retiradas: g.retirado,
        anuladas: g.anulada,
        total: g.activo + g.pendiente_cohorte + g.finalizado + g.retirado + g.anulada,
        _tipo: g.tipo,
      }))
      .sort((a, b) => byText(a.cohorte, b.cohorte) || byText(a.tipoCurso, b.tipoCurso));
    const total = (
      key: 'activas' | 'pendientes' | 'finalizadas' | 'retiradas' | 'anuladas' | 'total',
    ): number => sum(rows.map((row) => row[key]));
    const perCohort = new Map<string, number>();
    for (const row of rows)
      perCohort.set(row.cohorte, (perCohort.get(row.cohorte) ?? 0) + row.total);
    return this.table(
      'matriculas',
      'Matrículas registradas en el período, por cohorte, tipo de curso y estado actual.',
      [
        { key: 'cohorte', label: 'Cohorte', kind: 'text' },
        { key: 'tipoCurso', label: 'Tipo de curso', kind: 'text' },
        { key: 'activas', label: 'Activas', kind: 'integer' },
        { key: 'pendientes', label: 'Pendientes de cohorte', kind: 'integer' },
        { key: 'finalizadas', label: 'Finalizadas', kind: 'integer' },
        { key: 'retiradas', label: 'Retiradas', kind: 'integer' },
        { key: 'anuladas', label: 'Anuladas', kind: 'integer' },
        { key: 'total', label: 'Total', kind: 'integer' },
      ],
      rows.map(publicRow),
      {
        totals: {
          cohorte: 'Total',
          tipoCurso: '',
          activas: total('activas'),
          pendientes: total('pendientes'),
          finalizadas: total('finalizadas'),
          retiradas: total('retiradas'),
          anuladas: total('anuladas'),
          total: total('total'),
        },
        indicators: [
          { label: 'Matrículas registradas', kind: 'integer', value: total('total') },
          { label: 'Matrículas activas', kind: 'integer', value: total('activas') },
          {
            label: 'Tipo A',
            kind: 'integer',
            value: sum(rows.filter((row) => row._tipo === 'A').map((row) => row.total)),
          },
          {
            label: 'Tipo B',
            kind: 'integer',
            value: sum(rows.filter((row) => row._tipo === 'B').map((row) => row.total)),
          },
        ],
        notes: [
          'Cuenta la fecha de inscripción de cada matrícula. El estado es el vigente al generar el reporte.',
        ],
        chart: {
          title: 'Matrículas por cohorte',
          kind: 'integer',
          items: [...perCohort].map(([label, value]) => ({ label, value })),
        },
      },
    );
  }

  // (2) Asistencia a prácticas. Solo cuentan las horas con asistencia registrada.
  private async asistencia(
    f: ReportFilters,
    period: Period,
    catalog: Catalog,
  ): Promise<ReportTable> {
    interface Row {
      id: string;
      cohort_id: string | null;
      scheduled_at: string;
      duration_minutes: number;
      attended: boolean | null;
    }
    const data = await this.rows<Row>('practice_slots', (from, to) => {
      let query = this.db
        .from('practice_slots')
        .select('id,cohort_id,scheduled_at,duration_minutes,attended')
        .gte('scheduled_at', period.fromIso)
        .lt('scheduled_at', period.toIso)
        .not('attended', 'is', null);
      if (f.cohorteId) query = query.eq('cohort_id', f.cohorteId);
      return query.order('id').range(from, to);
    });
    const groups = new Map<string, Group & { attended: number; missed: number; minutes: number }>();
    for (const row of data) {
      if (row.attended === null) continue;
      const group: Group = {
        cohortId: row.cohort_id,
        tipo: row.cohort_id ? (catalog.cohorts.get(row.cohort_id)?.tipo ?? null) : null,
      };
      if (!inPeriod(row.scheduled_at, period) || !this.matches(f, group)) continue;
      const key = group.cohortId ?? '';
      const entry = groups.get(key) ?? { ...group, attended: 0, missed: 0, minutes: 0 };
      if (row.attended) {
        entry.attended += 1;
        entry.minutes += Number.isFinite(row.duration_minutes) ? row.duration_minutes : 0;
      } else entry.missed += 1;
      groups.set(key, entry);
    }
    const rows = [...groups.values()]
      .map((g) => ({
        ...this.groupLabels(g, catalog),
        asistidas: g.attended,
        faltas: g.missed,
        registradas: g.attended + g.missed,
        horasAsistidas: g.minutes / 60,
        asistencia: ratio(g.attended, g.attended + g.missed),
        _minutes: g.minutes,
      }))
      .sort((a, b) => byText(a.cohorte, b.cohorte));
    const attended = sum(rows.map((row) => row.asistidas));
    const missed = sum(rows.map((row) => row.faltas));
    const hours = sum(rows.map((row) => row._minutes)) / 60;
    return this.table(
      'asistencia',
      'Prácticas con asistencia registrada en el período, por cohorte.',
      [
        { key: 'cohorte', label: 'Cohorte', kind: 'text' },
        { key: 'tipoCurso', label: 'Tipo de curso', kind: 'text' },
        { key: 'asistidas', label: 'Prácticas asistidas', kind: 'integer' },
        { key: 'faltas', label: 'Faltas', kind: 'integer' },
        { key: 'registradas', label: 'Prácticas registradas', kind: 'integer' },
        { key: 'horasAsistidas', label: 'Horas asistidas', kind: 'decimal' },
        { key: 'asistencia', label: '% de asistencia', kind: 'percent' },
      ],
      rows.map(publicRow),
      {
        totals: {
          cohorte: 'Total',
          tipoCurso: '',
          asistidas: attended,
          faltas: missed,
          registradas: attended + missed,
          horasAsistidas: hours,
          asistencia: ratio(attended, attended + missed),
        },
        indicators: [
          { label: 'Prácticas asistidas', kind: 'integer', value: attended },
          { label: 'Faltas', kind: 'integer', value: missed },
          { label: 'Asistencia', kind: 'percent', value: ratio(attended, attended + missed) },
          { label: 'Horas asistidas', kind: 'decimal', value: hours },
        ],
        notes: [
          'Cuenta la fecha programada de cada práctica. Solo entran las prácticas con asistencia registrada (asistió o no asistió); las horas que cuentan son las asistidas.',
        ],
        chart: {
          title: 'Asistencia por cohorte',
          kind: 'percent',
          items: rows
            .filter((row) => row.asistencia !== null)
            .map((row) => ({ label: row.cohorte, value: row.asistencia ?? 0 })),
        },
      },
    );
  }

  // (3) Aprobación de exámenes. Fecha que cuenta: finalización del intento.
  private async examenes(f: ReportFilters, period: Period, catalog: Catalog): Promise<ReportTable> {
    interface Exam {
      id: string;
      title: string;
      type: 'practica' | 'definitivo';
      course_id: string;
    }
    interface Attempt {
      id: string;
      exam_id: string;
      student_id: string;
      status: string;
      passed: boolean | null;
      score_percent: string | number | null;
      completed_at: string | null;
    }
    const cohortFilter = f.cohorteId;
    const cohort = cohortFilter ? catalog.cohorts.get(cohortFilter) : undefined;
    const [exams, attempts, cohortStudents] = await Promise.all([
      this.rows<Exam>('exams', (from, to) =>
        this.db.from('exams').select('id,title,type,course_id').order('id').range(from, to),
      ),
      this.rows<Attempt>('exam_attempts', (from, to) =>
        this.db
          .from('exam_attempts')
          .select('id,exam_id,student_id,status,passed,score_percent,completed_at')
          .eq('status', 'completado')
          .gte('completed_at', period.fromIso)
          .lt('completed_at', period.toIso)
          .order('id')
          .range(from, to),
      ),
      cohortFilter
        ? this.rows<{ student_id: string }>('cohort_students', (from, to) =>
            this.db
              .from('enrollments')
              .select('id,student_id')
              .eq('cohort_id', cohortFilter)
              .order('id')
              .range(from, to),
          )
        : Promise.resolve(null),
    ]);
    const students = cohortStudents ? new Set(cohortStudents.map((row) => row.student_id)) : null;
    const examById = new Map(exams.map((exam) => [exam.id, exam]));
    const groups = new Map<
      string,
      { exam: Exam; passed: number; failed: number; scores: number[] }
    >();
    for (const attempt of attempts) {
      const exam = examById.get(attempt.exam_id);
      if (!exam || attempt.status !== 'completado' || attempt.score_percent === null) continue;
      if (!inPeriod(attempt.completed_at, period)) continue;
      const tipo = catalog.courseTypes.get(exam.course_id) ?? null;
      if (f.tipoCurso !== 'todos' && tipo !== f.tipoCurso) continue;
      if (students && (!students.has(attempt.student_id) || exam.course_id !== cohort?.courseId))
        continue;
      const entry = groups.get(exam.id) ?? { exam, passed: 0, failed: 0, scores: [] };
      if (attempt.passed === true) entry.passed += 1;
      else entry.failed += 1;
      const score = Number(attempt.score_percent);
      if (Number.isFinite(score)) entry.scores.push(score);
      groups.set(exam.id, entry);
    }
    const average = (scores: number[]): number | null =>
      scores.length ? Math.round((sum(scores) / scores.length) * 100) / 100 : null;
    const rows = [...groups.values()]
      .map((g) => ({
        examen: g.exam.title,
        tipoCurso: typeLabel(catalog.courseTypes.get(g.exam.course_id) ?? null),
        tipoExamen: g.exam.type === 'definitivo' ? 'Definitivo' : 'Práctica',
        intentos: g.passed + g.failed,
        aprobados: g.passed,
        reprobados: g.failed,
        aprobacion: ratio(g.passed, g.passed + g.failed),
        notaPromedio: average(g.scores),
        _final: g.exam.type === 'definitivo',
        _scores: g.scores,
      }))
      .sort((a, b) => byText(a.examen, b.examen) || byText(a.tipoCurso, b.tipoCurso));
    const passed = sum(rows.map((row) => row.aprobados));
    const total = sum(rows.map((row) => row.intentos));
    const finals = rows.filter((row) => row._final);
    return this.table(
      'examenes',
      'Intentos de examen finalizados en el período, por examen.',
      [
        { key: 'examen', label: 'Examen', kind: 'text' },
        { key: 'tipoCurso', label: 'Tipo de curso', kind: 'text' },
        { key: 'tipoExamen', label: 'Tipo de examen', kind: 'text' },
        { key: 'intentos', label: 'Intentos finalizados', kind: 'integer' },
        { key: 'aprobados', label: 'Aprobados', kind: 'integer' },
        { key: 'reprobados', label: 'Reprobados', kind: 'integer' },
        { key: 'aprobacion', label: '% de aprobación', kind: 'percent' },
        { key: 'notaPromedio', label: 'Nota promedio (%)', kind: 'decimal' },
      ],
      rows.map(publicRow),
      {
        totals: {
          examen: 'Total',
          tipoCurso: '',
          tipoExamen: '',
          intentos: total,
          aprobados: passed,
          reprobados: total - passed,
          aprobacion: ratio(passed, total),
          notaPromedio: average(rows.flatMap((row) => row._scores)),
        },
        indicators: [
          { label: 'Intentos finalizados', kind: 'integer', value: total },
          { label: 'Aprobados', kind: 'integer', value: passed },
          { label: 'Aprobación general', kind: 'percent', value: ratio(passed, total) },
          {
            label: 'Aprobación en exámenes definitivos',
            kind: 'percent',
            value: ratio(
              sum(finals.map((row) => row.aprobados)),
              sum(finals.map((row) => row.intentos)),
            ),
          },
        ],
        notes: [
          'Cuenta la fecha en que se finalizó cada intento. Solo entran los intentos finalizados y calificados.',
          ...(f.cohorteId
            ? [
                'Con cohorte seleccionada se cuentan los intentos de sus alumnos en exámenes de su curso.',
              ]
            : []),
        ],
        chart: {
          title: 'Aprobación por examen',
          kind: 'percent',
          items: rows
            .filter((row) => row.aprobacion !== null)
            .map((row) => ({ label: row.examen, value: row.aprobacion ?? 0 })),
        },
      },
    );
  }

  // (4) Finanzas: ingresos confirmados del período y saldo pendiente de sus matrículas.
  private async finanzas(f: ReportFilters, period: Period, catalog: Catalog): Promise<ReportTable> {
    interface Payment {
      id: string;
      enrollment_id: string | null;
      proveedor: 'simulado' | 'manual' | 'kushki';
      estado: string;
      total_centavos: number | string;
      confirmed_at: string | null;
    }
    interface Enrollment {
      id: string;
      course_type: CourseType;
      status: string;
      cohort_id: string | null;
      monto_total: string | number | null;
      monto_abonado: string | number | null;
      fecha_inscripcion: string;
    }
    const [payments, enrollments] = await Promise.all([
      this.rows<Payment>('payments', (from, to) =>
        this.db
          .from('payments')
          .select('id,enrollment_id,proveedor,estado,total_centavos,confirmed_at')
          .eq('estado', 'aprobado')
          .gte('confirmed_at', period.fromIso)
          .lt('confirmed_at', period.toIso)
          .order('id')
          .range(from, to),
      ),
      // Todas las matrículas: sirven para ubicar cada pago en su cohorte y
      // para el saldo de las inscritas en el período.
      this.rows<Enrollment>('finance_enrollments', (from, to) =>
        this.db
          .from('enrollments')
          .select('id,course_type,status,cohort_id,monto_total,monto_abonado,fecha_inscripcion')
          .order('id')
          .range(from, to),
      ),
    ]);
    const enrollmentById = new Map(enrollments.map((row) => [row.id, row]));
    interface Entry extends Group {
      orphan: boolean;
      count: number;
      online: number;
      cash: number;
      simulated: number;
      balance: number;
    }
    const groups = new Map<string, Entry>();
    const entryFor = (group: Group, orphan = false): Entry => {
      const key = orphan ? 'orphan' : `${group.cohortId ?? ''}|${group.tipo ?? ''}`;
      let entry = groups.get(key);
      if (!entry) {
        entry = { ...group, orphan, count: 0, online: 0, cash: 0, simulated: 0, balance: 0 };
        groups.set(key, entry);
      }
      return entry;
    };
    let simulatedCount = 0;
    for (const payment of payments) {
      if (payment.estado !== 'aprobado' || !inPeriod(payment.confirmed_at, period)) continue;
      const amount = Number(payment.total_centavos);
      if (!Number.isSafeInteger(amount) || amount < 0) continue;
      const enrollment = payment.enrollment_id
        ? enrollmentById.get(payment.enrollment_id)
        : undefined;
      const group: Group = enrollment
        ? { cohortId: enrollment.cohort_id, tipo: enrollment.course_type }
        : { cohortId: null, tipo: null };
      if (!this.matches(f, group)) continue;
      const entry = entryFor(group, !enrollment);
      if (payment.proveedor === 'simulado') {
        // Pago de demostración: nunca entra en los ingresos reales.
        entry.simulated += amount;
        simulatedCount += 1;
        continue;
      }
      entry.count += 1;
      if (payment.proveedor === 'manual') entry.cash += amount;
      else entry.online += amount;
    }
    let unpriced = 0;
    for (const enrollment of enrollments) {
      if (!inPeriod(enrollment.fecha_inscripcion, period)) continue;
      if (!['activo', 'pendiente_cohorte', 'finalizado'].includes(enrollment.status)) continue;
      const group: Group = { cohortId: enrollment.cohort_id, tipo: enrollment.course_type };
      if (!this.matches(f, group)) continue;
      const total = dollarsToCentavos(enrollment.monto_total);
      if (total === null) {
        unpriced += 1;
        continue;
      }
      const paid = dollarsToCentavos(enrollment.monto_abonado) ?? 0;
      const pending = Math.max(0, total - paid);
      if (pending > 0) entryFor(group).balance += pending;
    }
    const showSimulated = this.demoMode || simulatedCount > 0;
    const rows = [...groups.values()]
      .filter((g) => g.count || g.simulated || g.balance)
      .map((g) => ({
        ...(g.orphan
          ? { cohorte: 'Sin matrícula asociada', tipoCurso: typeLabel(null) }
          : this.groupLabels(g, catalog)),
        pagos: g.count,
        enLinea: g.online,
        efectivo: g.cash,
        ingresos: g.online + g.cash,
        ...(showSimulated ? { simulados: g.simulated } : {}),
        saldoPendiente: g.balance,
      }))
      .sort((a, b) => byText(a.cohorte, b.cohorte) || byText(a.tipoCurso, b.tipoCurso));
    const total = (key: 'pagos' | 'enLinea' | 'efectivo' | 'ingresos' | 'saldoPendiente'): number =>
      sum(rows.map((row) => row[key]));
    const simulatedTotal = sum([...groups.values()].map((g) => g.simulated));
    const perCohort = new Map<string, number>();
    for (const row of rows)
      perCohort.set(row.cohorte, (perCohort.get(row.cohorte) ?? 0) + row.ingresos);
    return this.table(
      'finanzas',
      'Ingresos confirmados en el período por cohorte y saldo pendiente de las matrículas del período.',
      [
        { key: 'cohorte', label: 'Cohorte', kind: 'text' },
        { key: 'tipoCurso', label: 'Tipo de curso', kind: 'text' },
        { key: 'pagos', label: 'Pagos confirmados', kind: 'integer' },
        { key: 'enLinea', label: 'Ingresos en línea', kind: 'money' },
        { key: 'efectivo', label: 'Ingresos en efectivo', kind: 'money' },
        { key: 'ingresos', label: 'Ingresos confirmados', kind: 'money' },
        ...(showSimulated
          ? [{ key: 'simulados', label: 'Pagos simulados (demostración)', kind: 'money' as const }]
          : []),
        { key: 'saldoPendiente', label: 'Saldo pendiente', kind: 'money' },
      ],
      rows,
      {
        totals: {
          cohorte: 'Total',
          tipoCurso: '',
          pagos: total('pagos'),
          enLinea: total('enLinea'),
          efectivo: total('efectivo'),
          ingresos: total('ingresos'),
          ...(showSimulated ? { simulados: simulatedTotal } : {}),
          saldoPendiente: total('saldoPendiente'),
        },
        indicators: [
          { label: 'Ingresos confirmados', kind: 'money', value: total('ingresos') },
          { label: 'Pagos confirmados', kind: 'integer', value: total('pagos') },
          { label: 'Saldo pendiente global', kind: 'money', value: total('saldoPendiente') },
          ...(showSimulated
            ? [
                {
                  label: 'Pagos simulados (excluidos)',
                  kind: 'money' as const,
                  value: simulatedTotal,
                },
              ]
            : []),
        ],
        notes: [
          'Ingreso = pago aprobado, contado en la fecha de confirmación del pago (no en la de matrícula). Incluye pagos en línea y pagos en efectivo registrados por el administrador.',
          'Saldo pendiente = total menos abonado de las matrículas inscritas en el período (activas, pendientes de cohorte o finalizadas), calculado al generar el reporte.',
          'No se incluyen pagos pendientes, rechazados ni en revisión.',
          ...(showSimulated
            ? [
                'Los pagos simulados del modo demostración se muestran aparte y no suman a los ingresos confirmados.',
              ]
            : []),
          ...(unpriced
            ? [
                `${String(unpriced)} matrícula(s) del período sin precio definido no entran en el saldo.`,
              ]
            : []),
        ],
        chart: {
          title: 'Ingresos confirmados por cohorte',
          kind: 'money',
          items: [...perCohort]
            .filter(([, value]) => value > 0)
            .map(([label, value]) => ({ label, value })),
        },
      },
    );
  }

  // (5) Ranking de instructores (RF-04). Solo administrador. Sin datos de alumnos ni comentarios.
  private async instructores(
    f: ReportFilters,
    period: Period,
    catalog: Catalog,
  ): Promise<ReportTable> {
    interface Rating {
      id: string;
      instructor_id: string;
      student_id: string;
      score: number;
      created_at: string;
      invalidated_at: string | null;
      slot: {
        attended: boolean | null;
        status: string;
        cohort_id: string | null;
        student_id: string | null;
        instructor_id: string;
      } | null;
    }
    const [ratings, instructors] = await Promise.all([
      this.rows<Rating>('practice_ratings', (from, to) =>
        this.db
          .from('practice_ratings')
          .select(
            'id,instructor_id,student_id,score,created_at,invalidated_at,slot:practice_slots!practice_ratings_practice_slot_id_fkey(attended,status,cohort_id,student_id,instructor_id)',
          )
          .is('invalidated_at', null)
          .gte('created_at', period.fromIso)
          .lt('created_at', period.toIso)
          .order('id')
          .range(from, to)
          .overrideTypes<Rating[], { merge: false }>(),
      ),
      this.rows<{ id: string; nombre_completo: string; activo: boolean }>(
        'instructors',
        (from, to) =>
          this.db
            .from('users')
            .select('id,nombre_completo,activo')
            .eq('rol', 'instructor')
            .order('id')
            .range(from, to),
      ),
    ]);
    const people = new Map(instructors.map((person) => [person.id, person]));
    const groups = new Map<string, number[]>();
    for (const rating of ratings) {
      const slot = rating.slot;
      // Misma validez que la pantalla de RF-04: calificación vigente de una práctica asistida.
      if (rating.invalidated_at !== null || slot?.attended !== true) continue;
      if (slot.status !== 'completado') continue;
      if (slot.student_id !== rating.student_id || slot.instructor_id !== rating.instructor_id)
        continue;
      if (!Number.isInteger(rating.score) || rating.score < 1 || rating.score > 5) continue;
      if (!inPeriod(rating.created_at, period)) continue;
      const group: Group = {
        cohortId: slot.cohort_id,
        tipo: slot.cohort_id ? (catalog.cohorts.get(slot.cohort_id)?.tipo ?? null) : null,
      };
      if (!this.matches(f, group)) continue;
      const stars = groups.get(rating.instructor_id) ?? [0, 0, 0, 0, 0];
      stars[rating.score - 1] += 1;
      groups.set(rating.instructor_id, stars);
    }
    const ranked = [...groups]
      .map(([id, stars]) => {
        const responses = sum(stars);
        const points = sum(stars.map((count, index) => count * (index + 1)));
        return {
          id,
          name: people.get(id)?.nombre_completo ?? 'Instructor no disponible',
          active: people.get(id)?.activo ?? false,
          stars,
          responses,
          points,
          average: responses ? Math.round((points / responses) * 100) / 100 : null,
          eligible: responses >= RANKING_MIN_RESPONSES,
        };
      })
      .sort(
        (a, b) =>
          Number(b.eligible) - Number(a.eligible) ||
          (b.average ?? 0) - (a.average ?? 0) ||
          b.responses - a.responses ||
          byText(a.name, b.name) ||
          a.id.localeCompare(b.id),
      );
    const rows = ranked.map((item, index) => ({
      posicion: index + 1,
      instructor: item.name,
      estado: item.active ? 'Activo' : 'Inactivo',
      promedio: item.average,
      calificaciones: item.responses,
      estrellas5: item.stars[4],
      estrellas4: item.stars[3],
      estrellas3: item.stars[2],
      estrellas2: item.stars[1],
      estrellas1: item.stars[0],
      observacion: item.eligible ? '' : 'Pocas calificaciones',
    }));
    const responses = sum(ranked.map((item) => item.responses));
    const points = sum(ranked.map((item) => item.points));
    const overall = responses ? Math.round((points / responses) * 100) / 100 : null;
    const starTotal = (index: number): number => sum(ranked.map((item) => item.stars[index]));
    return this.table(
      'instructores',
      'Calificaciones de instructores (escala de 1 a 5) recibidas en el período.',
      [
        { key: 'posicion', label: 'Posición', kind: 'integer' },
        { key: 'instructor', label: 'Instructor', kind: 'text' },
        { key: 'estado', label: 'Estado', kind: 'text' },
        { key: 'promedio', label: 'Promedio', kind: 'decimal' },
        { key: 'calificaciones', label: 'Calificaciones', kind: 'integer' },
        { key: 'estrellas5', label: '5 estrellas', kind: 'integer' },
        { key: 'estrellas4', label: '4 estrellas', kind: 'integer' },
        { key: 'estrellas3', label: '3 estrellas', kind: 'integer' },
        { key: 'estrellas2', label: '2 estrellas', kind: 'integer' },
        { key: 'estrellas1', label: '1 estrella', kind: 'integer' },
        { key: 'observacion', label: 'Observación', kind: 'text' },
      ],
      rows,
      {
        totals: {
          posicion: null,
          instructor: 'Total',
          estado: '',
          promedio: overall,
          calificaciones: responses,
          estrellas5: starTotal(4),
          estrellas4: starTotal(3),
          estrellas3: starTotal(2),
          estrellas2: starTotal(1),
          estrellas1: starTotal(0),
          observacion: '',
        },
        indicators: [
          { label: 'Instructores calificados', kind: 'integer', value: ranked.length },
          { label: 'Calificaciones válidas', kind: 'integer', value: responses },
          { label: 'Promedio general', kind: 'decimal', value: overall },
        ],
        notes: [
          'Cuenta la fecha en que se registró cada calificación. Solo entran calificaciones vigentes de prácticas asistidas; las anuladas por corrección de asistencia no cuentan.',
          `Un instructor entra al ranking con al menos ${String(RANKING_MIN_RESPONSES)} calificaciones; con menos aparece al final como «Pocas calificaciones».`,
          'El reporte no identifica a los alumnos ni incluye sus comentarios.',
        ],
        chart: {
          title: 'Promedio por instructor',
          kind: 'decimal',
          items: ranked
            // Solo quienes entran al ranking: el gráfico respeta el orden de la tabla.
            .filter((item) => item.eligible && item.average !== null)
            .map((item) => ({ label: item.name, value: item.average ?? 0 })),
        },
      },
    );
  }
}
