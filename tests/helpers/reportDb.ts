// Base de datos en memoria para las pruebas de reportes (RF-08). Imita lo que
// ReportService usa de supabase-js: filtros eq/gte/lt/is/not, order, range,
// maybeSingle e insert. A diferencia de createChain, SÍ aplica los filtros y la
// paginación, de modo que las pruebas ejercitan límites de fecha y páginas.
type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;
const time = (value: unknown): number => new Date(String(value)).getTime();

export interface ReportDbFake {
  from: jest.Mock;
  rpc: jest.Mock;
  inserted: Record<string, Row[]>;
  /** Tablas consultadas, en orden (para comprobar que no hay N+1). */
  calls: string[];
}

export function createReportDb(
  tables: Record<string, Row[]>,
  options: { failTable?: string; failInsert?: boolean } = {},
): ReportDbFake {
  const inserted: Record<string, Row[]> = {};
  const calls: string[] = [];
  const from = jest.fn((table: string) => {
    calls.push(table);
    const predicates: Predicate[] = [];
    let window: [number, number] | null = null;
    const result = (): { data: Row[] | null; error: { code: string } | null } => {
      if (options.failTable === table) return { data: null, error: { code: 'XX000' } };
      const filtered = (tables[table] ?? []).filter((row) => predicates.every((test) => test(row)));
      return { data: window ? filtered.slice(window[0], window[1] + 1) : filtered, error: null };
    };
    const chain = {
      select: () => chain,
      order: () => chain,
      overrideTypes: () => chain,
      eq: (column: string, value: unknown) => {
        predicates.push((row) => row[column] === value);
        return chain;
      },
      gte: (column: string, value: unknown) => {
        predicates.push((row) => row[column] != null && time(row[column]) >= time(value));
        return chain;
      },
      lt: (column: string, value: unknown) => {
        predicates.push((row) => row[column] != null && time(row[column]) < time(value));
        return chain;
      },
      is: (column: string, value: unknown) => {
        predicates.push((row) => (row[column] ?? null) === value);
        return chain;
      },
      not: (column: string, _operator: string, value: unknown) => {
        predicates.push((row) => (row[column] ?? null) !== value);
        return chain;
      },
      range: (start: number, end: number) => {
        window = [start, end];
        return chain;
      },
      maybeSingle: () => {
        const { data, error } = result();
        return Promise.resolve({ data: data?.[0] ?? null, error });
      },
      insert: (row: Row) => {
        if (options.failInsert) return Promise.resolve({ error: { code: '42501' } });
        (inserted[table] ??= []).push(row);
        return Promise.resolve({ error: null });
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return chain;
  });
  return { from, rpc: jest.fn().mockResolvedValue({ data: null, error: null }), inserted, calls };
}

// Conjunto de datos de ejemplo con tildes y eñes, dos cohortes (A y B) y casos
// en los bordes del período de noviembre de 2026 (hora de Ecuador, UTC-5).
export const IDS = {
  admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  courseA: 'c0000000-0000-4000-8000-00000000000a',
  courseB: 'c0000000-0000-4000-8000-00000000000b',
  cohortA: '10000000-0000-4000-8000-00000000000a',
  cohortB: '10000000-0000-4000-8000-00000000000b',
  examA: 'e0000000-0000-4000-8000-00000000000a',
  examB: 'e0000000-0000-4000-8000-00000000000b',
  instructor1: '20000000-0000-4000-8000-000000000001',
  instructor2: '20000000-0000-4000-8000-000000000002',
};
const student = (n: number): string => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const enrollment = (n: number): string => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function sampleTables(): Record<string, Row[]> {
  const rating = (
    n: number,
    instructor: string,
    score: number,
    createdAt: string,
    extra: Row = {},
    slot: Row = {},
  ): Row => ({
    id: `r${String(n)}`,
    instructor_id: instructor,
    student_id: student(n),
    score,
    created_at: createdAt,
    invalidated_at: null,
    slot: {
      attended: true,
      status: 'completado',
      cohort_id: IDS.cohortB,
      student_id: student(n),
      instructor_id: instructor,
      ...slot,
    },
    ...extra,
  });
  return {
    users: [
      { id: IDS.admin, nombre_completo: 'Erick Peñafiel Muñoz', rol: 'admin', activo: true },
      {
        id: IDS.instructor1,
        nombre_completo: 'José Ñáñez Ibáñez',
        rol: 'instructor',
        activo: true,
      },
      { id: IDS.instructor2, nombre_completo: 'María Güiza', rol: 'instructor', activo: false },
    ],
    courses: [
      { id: IDS.courseA, tipo: 'A' },
      { id: IDS.courseB, tipo: 'B' },
    ],
    cohorts: [
      { id: IDS.cohortA, nombre: 'Cohorte Motocicleta Noviembre', course_id: IDS.courseA },
      { id: IDS.cohortB, nombre: 'Cohorte Vehículos Livianos Ñ', course_id: IDS.courseB },
    ],
    enrollments: [
      // Dentro del período.
      {
        id: enrollment(1),
        student_id: student(1),
        course_type: 'A',
        status: 'activo',
        cohort_id: IDS.cohortA,
        monto_total: '150.00',
        monto_abonado: '150.00',
        fecha_inscripcion: '2026-11-02T15:00:00Z',
      },
      {
        id: enrollment(2),
        student_id: student(2),
        course_type: 'A',
        status: 'activo',
        cohort_id: IDS.cohortA,
        monto_total: '150.00',
        monto_abonado: '50.10',
        fecha_inscripcion: '2026-11-03T15:00:00Z',
      },
      {
        id: enrollment(3),
        student_id: student(3),
        course_type: 'B',
        status: 'finalizado',
        cohort_id: IDS.cohortB,
        monto_total: '200.00',
        monto_abonado: '200.00',
        fecha_inscripcion: '2026-11-10T15:00:00Z',
      },
      {
        id: enrollment(4),
        student_id: student(4),
        course_type: 'B',
        status: 'pendiente_cohorte',
        cohort_id: null,
        monto_total: null,
        monto_abonado: '0',
        fecha_inscripcion: '2026-11-12T15:00:00Z',
      },
      {
        id: enrollment(5),
        student_id: student(5),
        course_type: 'B',
        status: 'retirado',
        cohort_id: IDS.cohortB,
        monto_total: '200.00',
        monto_abonado: '0',
        fecha_inscripcion: '2026-11-15T15:00:00Z',
      },
      // Borde: 30/11 23:59:59 de Ecuador (= 01/12 04:59:59Z) SÍ entra.
      {
        id: enrollment(6),
        student_id: student(6),
        course_type: 'B',
        status: 'activo',
        cohort_id: IDS.cohortB,
        monto_total: '200.00',
        monto_abonado: '0.30',
        fecha_inscripcion: '2026-12-01T04:59:59Z',
      },
      // Borde: 01/12 00:00:00 de Ecuador (= 01/12 05:00:00Z) NO entra.
      {
        id: enrollment(7),
        student_id: student(7),
        course_type: 'B',
        status: 'activo',
        cohort_id: IDS.cohortB,
        monto_total: '200.00',
        monto_abonado: '0',
        fecha_inscripcion: '2026-12-01T05:00:00Z',
      },
      // Borde: 31/10 23:59:59 de Ecuador (= 01/11 04:59:59Z) NO entra.
      {
        id: enrollment(8),
        student_id: student(8),
        course_type: 'A',
        status: 'activo',
        cohort_id: IDS.cohortA,
        monto_total: '150.00',
        monto_abonado: '0',
        fecha_inscripcion: '2026-11-01T04:59:59Z',
      },
    ],
    practice_slots: [
      {
        id: 's1',
        cohort_id: IDS.cohortA,
        scheduled_at: '2026-11-05T13:00:00Z',
        duration_minutes: 60,
        attended: true,
      },
      {
        id: 's2',
        cohort_id: IDS.cohortA,
        scheduled_at: '2026-11-05T14:00:00Z',
        duration_minutes: 60,
        attended: true,
      },
      {
        id: 's3',
        cohort_id: IDS.cohortA,
        scheduled_at: '2026-11-06T13:00:00Z',
        duration_minutes: 60,
        attended: false,
      },
      {
        id: 's4',
        cohort_id: IDS.cohortB,
        scheduled_at: '2026-11-07T13:00:00Z',
        duration_minutes: 60,
        attended: true,
      },
      // Sin asistencia registrada: no cuenta.
      {
        id: 's5',
        cohort_id: IDS.cohortB,
        scheduled_at: '2026-11-08T13:00:00Z',
        duration_minutes: 60,
        attended: null,
      },
      // Fuera del período.
      {
        id: 's6',
        cohort_id: IDS.cohortB,
        scheduled_at: '2026-12-02T13:00:00Z',
        duration_minutes: 60,
        attended: true,
      },
    ],
    exams: [
      {
        id: IDS.examA,
        title: 'Examen teórico de señalización',
        type: 'definitivo',
        course_id: IDS.courseA,
      },
      { id: IDS.examB, title: 'Simulacro de conducción', type: 'practica', course_id: IDS.courseB },
    ],
    exam_attempts: [
      {
        id: 'a1',
        exam_id: IDS.examA,
        student_id: student(1),
        status: 'completado',
        passed: true,
        score_percent: '90.00',
        completed_at: '2026-11-09T15:00:00Z',
      },
      {
        id: 'a2',
        exam_id: IDS.examA,
        student_id: student(2),
        status: 'completado',
        passed: false,
        score_percent: '55.50',
        completed_at: '2026-11-09T16:00:00Z',
      },
      {
        id: 'a3',
        exam_id: IDS.examA,
        student_id: student(2),
        status: 'completado',
        passed: true,
        score_percent: '80.00',
        completed_at: '2026-11-11T16:00:00Z',
      },
      {
        id: 'a4',
        exam_id: IDS.examB,
        student_id: student(3),
        status: 'completado',
        passed: true,
        score_percent: '100.00',
        completed_at: '2026-11-12T16:00:00Z',
      },
      // En curso: no cuenta.
      {
        id: 'a5',
        exam_id: IDS.examB,
        student_id: student(3),
        status: 'en_progreso',
        passed: null,
        score_percent: null,
        completed_at: null,
      },
      // Fuera del período.
      {
        id: 'a6',
        exam_id: IDS.examB,
        student_id: student(3),
        status: 'completado',
        passed: false,
        score_percent: '10.00',
        completed_at: '2026-10-12T16:00:00Z',
      },
    ],
    payments: [
      {
        id: 'p1',
        enrollment_id: enrollment(1),
        proveedor: 'kushki',
        estado: 'aprobado',
        total_centavos: 15000,
        confirmed_at: '2026-11-02T15:05:00Z',
      },
      {
        id: 'p2',
        enrollment_id: enrollment(2),
        proveedor: 'manual',
        estado: 'aprobado',
        total_centavos: 5010,
        confirmed_at: '2026-11-03T15:05:00Z',
      },
      {
        id: 'p3',
        enrollment_id: enrollment(3),
        proveedor: 'kushki',
        estado: 'aprobado',
        total_centavos: 20000,
        confirmed_at: '2026-11-10T15:05:00Z',
      },
      // Efectivo con centavos que fallarían en punto flotante (0,10 + 0,20).
      {
        id: 'p4',
        enrollment_id: enrollment(6),
        proveedor: 'manual',
        estado: 'aprobado',
        total_centavos: 10,
        confirmed_at: '2026-11-20T15:05:00Z',
      },
      {
        id: 'p5',
        enrollment_id: enrollment(6),
        proveedor: 'manual',
        estado: 'aprobado',
        total_centavos: 20,
        confirmed_at: '2026-11-21T15:05:00Z',
      },
      // Simulado (demostración): se muestra aparte, no suma.
      {
        id: 'p6',
        enrollment_id: enrollment(3),
        proveedor: 'simulado',
        estado: 'aprobado',
        total_centavos: 20000,
        confirmed_at: '2026-11-10T15:06:00Z',
      },
      // No aprobados: no cuentan.
      {
        id: 'p7',
        enrollment_id: enrollment(5),
        proveedor: 'kushki',
        estado: 'revision',
        total_centavos: 20000,
        confirmed_at: '2026-11-15T15:05:00Z',
      },
      {
        id: 'p8',
        enrollment_id: enrollment(5),
        proveedor: 'kushki',
        estado: 'rechazado',
        total_centavos: 20000,
        confirmed_at: null,
      },
      // Matrícula de noviembre pagada en diciembre: el ingreso es de diciembre.
      {
        id: 'p9',
        enrollment_id: enrollment(2),
        proveedor: 'kushki',
        estado: 'aprobado',
        total_centavos: 9990,
        confirmed_at: '2026-12-01T05:00:00Z',
      },
    ],
    practice_ratings: [
      rating(1, IDS.instructor1, 5, '2026-11-05T16:00:00Z'),
      rating(2, IDS.instructor1, 5, '2026-11-06T16:00:00Z'),
      rating(3, IDS.instructor1, 4, '2026-11-07T16:00:00Z'),
      rating(4, IDS.instructor1, 2, '2026-11-08T16:00:00Z', {}, { cohort_id: IDS.cohortA }),
      rating(5, IDS.instructor2, 5, '2026-11-08T16:00:00Z'),
      // Anulada por corrección de asistencia: no cuenta.
      rating(6, IDS.instructor2, 1, '2026-11-09T16:00:00Z', {
        invalidated_at: '2026-11-10T16:00:00Z',
      }),
      // La práctica quedó como «no asistió»: no cuenta.
      rating(7, IDS.instructor2, 1, '2026-11-09T16:00:00Z', {}, { attended: false }),
    ],
  };
}

export const NOVEMBER = { desde: '2026-11-01', hasta: '2026-11-30' } as const;
