import {
  studentGraduation,
  studentSchedule,
  type StudentSlot,
} from '../../src/services/studentGraduation';
const now = new Date('2026-10-16T15:00:00Z');
const enrollment = {
  id: 'e1',
  student_id: 'student',
  course_id: 'course',
  cohort_id: 'cohort',
  status: 'activo' as const,
  monto_total: '100',
  monto_abonado: '30',
  horas_practica_objetivo: 10,
};
const docs = ['cedula', 'papeleta_votacion', 'tipo_sangre', 'titulo_bachiller'].map((tipo) => ({
  enrollment_id: 'e1',
  tipo,
  estado: tipo === 'cedula' ? 'pendiente' : 'entregado',
}));
const exams = [
  { id: 'x1', course_id: 'course' },
  { id: 'x2', course_id: 'course' },
];
const attempts = [
  { exam_id: 'x1', status: 'completado' as const, passed: true },
  { exam_id: 'x2', status: 'completado' as const, passed: false },
];
const courses = [{ id: 'course', nombre: 'Curso de prueba' }];
const slot = (n: number, extra: Partial<StudentSlot> = {}): StudentSlot => ({
  id: 'slot-' + String(n),
  cohort_id: 'cohort',
  instructor_id: 'teacher',
  scheduled_at: '2026-10-15T15:00:00Z',
  duration_minutes: 60,
  status: 'completado',
  attended: true,
  ...extra,
});
const sixHours = Array.from({ length: 6 }, (_, i) => slot(i));

describe('Graduación por matrícula vigente', () => {
  it('alumno de prueba: pago parcial, 6/10 horas, 1/2 definitivos y falta cédula', () => {
    const result = studentGraduation([enrollment], docs, courses, exams, attempts, [
      ...sixHours,
      slot(7, { attended: false }),
      slot(8, { status: 'confirmado', attended: null }),
      slot(9, { cohort_id: 'otra' }),
    ]);
    expect(result.pendingCount).toBe(4);
    expect(result.enrollments[0].checks.map((c) => c.fulfilled)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(result.enrollments[0].checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'payments',
          detail: 'Saldo pendiente $70.00; abonado $30.00',
        }),
        expect.objectContaining({ key: 'practice', detail: '6 de 10 horas' }),
        expect.objectContaining({ key: 'exams', detail: '1 de 2 aprobados' }),
        expect.objectContaining({ key: 'documents', detail: 'Falta: cédula' }),
      ]),
    );
  });
  it('no sustituye objetivo nulo, precio desconocido ni documentos ausentes', () => {
    const r = studentGraduation(
      [
        {
          ...enrollment,
          cohort_id: null,
          monto_total: null,
          horas_practica_objetivo: null,
          status: 'pendiente_cohorte',
        },
      ],
      [],
      courses,
      [],
      [],
      sixHours,
    );
    expect(r.pendingCount).toBe(5);
    expect(r.enrollments[0].checks.find((c) => c.key === 'practice')).toMatchObject({
      fulfilled: false,
      detail: '0 horas cumplidas; objetivo sin registrar',
    });
    expect(r.enrollments[0].checks.find((c) => c.key === 'payments')?.detail).toContain(
      'Total aún no definido',
    );
    expect(r.enrollments[0].checks.find((c) => c.key === 'documents')?.detail).toContain('cédula');
  });
  it('completo exige pago total, todas las horas, documentos y todos los definitivos', () => {
    const r = studentGraduation(
      [{ ...enrollment, monto_abonado: '100', horas_practica_objetivo: 6 }],
      docs.map((d) => ({ ...d, estado: 'no_aplica' })),
      courses,
      exams,
      attempts.map((a) => ({ ...a, passed: true })),
      sixHours,
    );
    expect(r.pendingCount).toBe(0);
    expect(r.enrollments[0].checks.every((c) => c.fulfilled)).toBe(true);
  });
  it('no suma saldos ni horas entre cohortes; no evalúa matrículas finalizadas o retiradas', () => {
    const r = studentGraduation(
      [
        enrollment,
        {
          ...enrollment,
          id: 'other',
          course_id: 'other',
          cohort_id: 'other',
          status: 'pendiente_cohorte',
          monto_abonado: '0',
        },
        { ...enrollment, id: 'old', status: 'finalizado' },
        { ...enrollment, id: 'gone', status: 'retirado' },
      ],
      docs,
      courses,
      exams,
      attempts,
      sixHours,
    );
    expect(r.enrollments).toHaveLength(2);
    expect(r.enrollments[1].checks.find((c) => c.key === 'practice')?.detail).toBe('0 de 10 horas');
    expect(studentGraduation([], [], [], [], [], [])).toEqual({
      pendingCount: null,
      enrollments: [],
    });
  });
  it('no infiere aprobación por intento en progreso y no duplica aprobaciones', () => {
    const r = studentGraduation(
      [enrollment],
      docs,
      courses,
      exams,
      [...attempts, attempts[0], { exam_id: 'x2', status: 'en_progreso', passed: true }],
      sixHours,
    );
    expect(r.enrollments[0].checks.find((c) => c.key === 'exams')?.detail).toBe('1 de 2 aprobados');
  });
  it('las horas usan todas las asistencias aunque el historial visible se limite a 10', () => {
    const slots = Array.from({ length: 15 }, (_, i) => slot(i));
    expect(
      studentGraduation(
        [enrollment],
        docs,
        courses,
        exams,
        attempts,
        slots,
      ).enrollments[0].checks.find((c) => c.key === 'practice')?.detail,
    ).toBe('15 de 10 horas');
    expect(studentSchedule(slots, [], [], now).recent).toHaveLength(10);
  });
});
describe('Horario solo lectura', () => {
  it('ordena próximas, conserva snapshots de liberación/reprogramación y evita duplicar reservas restauradas', () => {
    const slots = [
      slot(2, { scheduled_at: '2026-10-18T15:00:00Z', status: 'confirmado', attended: null }),
      slot(1, { scheduled_at: '2026-10-17T15:00:00Z', status: 'asignado', attended: null }),
      slot(3),
    ];
    const recovery = [
      {
        slot_id: 'released',
        cohort_id: 'cohort',
        instructor_id: 'teacher',
        scheduled_at: '2026-10-19T15:00:00Z',
        status: 'cancelada_por_desactivacion',
        reason: null,
      },
      {
        slot_id: 'pending',
        cohort_id: 'cohort',
        instructor_id: 'missing',
        scheduled_at: '2026-10-14T15:00:00Z',
        status: 'pendiente_reprogramar',
        reason: 'ocupada',
      },
      {
        slot_id: 'slot-1',
        cohort_id: 'cohort',
        instructor_id: 'teacher',
        scheduled_at: '2026-10-17T15:00:00Z',
        status: 'pendiente_reprogramar',
        reason: null,
      },
    ];
    const r = studentSchedule(
      slots,
      recovery,
      [{ id: 'teacher', nombre_completo: 'Instructor de prueba' }],
      now,
    );
    expect(r.upcoming.map((s) => s.status)).toEqual(['reservada', 'confirmada']);
    expect(r.recovery.map((s) => s.status)).toEqual(['pendiente_reprogramar', 'liberada']);
    expect(r.recovery[0].instructor).toBeNull();
    expect(r.upcoming[0].instructor).toBe('Instructor de prueba');
    expect(r.recent[0]).toMatchObject({ id: 'slot-3', status: 'completada', attended: true });
    expect(JSON.stringify(r)).not.toContain('instructor_id');
  });
  it('conserva snapshot si la franja fue movida o cambió de instructor', () => {
    const r = studentSchedule(
      [slot(1, { status: 'asignado', attended: null, scheduled_at: '2026-10-18T15:00:00Z' })],
      [
        {
          slot_id: 'slot-1',
          cohort_id: 'cohort',
          instructor_id: 'teacher',
          scheduled_at: '2026-10-17T15:00:00Z',
          status: 'pendiente_reprogramar',
          reason: 'franja_modificada',
        },
      ],
      [],
      now,
    );
    expect(r.recovery).toHaveLength(1);
    expect(r.upcoming).toHaveLength(1);
  });
});
