import { manualPracticePlan } from '../../src/utils/manualPracticePlan';
import type { ManualPracticeInput } from '../../src/models/manualEnrollment.model';
const base: ManualPracticeInput = {
  semanas: 1,
  modalidad: 'entre_semana',
  fechaInicio: '2026-09-30',
  horaDeseada: '08:00',
  horasPorDia: 2,
};
describe('Plan civil compartido con el wizard por HTTP', () => {
  it.each([
    ['2026-09-30', 'entre_semana', 1, '2026-10-06', 5],
    ['2026-10-04', 'fin_de_semana', 1, '2026-10-10', 2],
    ['2026-12-30', 'entre_semana', 1, '2027-01-05', 5],
    ['2026-12-27', 'fin_de_semana', 3, '2027-01-16', 6],
    ['2026-09-30', 'entre_semana', 2, '2026-10-13', 10],
    ['2026-09-30', 'entre_semana', 3, '2026-10-20', 15],
    ['2026-10-04', 'fin_de_semana', 2, '2026-10-17', 4],
  ] as const)('%s %s %s semanas → %s', (fechaInicio, modalidad, semanas, end, days) => {
    const p = manualPracticePlan({ ...base, fechaInicio, modalidad, semanas });
    expect(p.fechaFin).toBe(end);
    expect(p.dias).toBe(days);
    expect(p.bloques).toBe(days * 2);
    expect(p.timezone).toBe('America/Guayaquil');
  });
  it.each([
    ['2026-10-03', 'entre_semana', '2026-10-05'],
    ['2026-10-05', 'fin_de_semana', '2026-10-10'],
  ] as const)('conserva inicio no aplicable %s', (fechaInicio, modalidad, effective) => {
    const p = manualPracticePlan({ ...base, fechaInicio, modalidad });
    expect(p.fechaInicio).toBe(fechaInicio);
    expect(p.primerDiaEfectivo).toBe(effective);
  });
  it('horas por día no cambia la cantidad de días', () => {
    expect(manualPracticePlan({ ...base, horasPorDia: 3 }).dias).toBe(5);
  });
  it('rango manual inclusivo sin tarifa extra', () => {
    const p = manualPracticePlan({ ...base, fechaFin: '2026-10-11' });
    expect(p.dias).toBe(8);
    expect(p.bloques).toBe(16);
    expect(p.fechaFin).toBe('2026-10-09');
    expect(p.fechaFinElegida).toBe('2026-10-11');
    expect(p.semanas).toBe(1);
  });
  it('restaurar automático equivale a omitir fechaFin', () => {
    expect(manualPracticePlan(base)).toMatchObject({ manual: false, fechaFin: '2026-10-06' });
  });
  it.each([
    { fechaFin: '2026-09-29' },
    { fechaInicio: '2026-10-03', fechaFin: '2026-10-04' },
    { fechaInicio: '2026-02-30' },
    { horasPorDia: 1.5 },
    { horasPorDia: 0 },
    { horasPorDia: 7 },
    { horasPorDia: 16 },
    { horaDeseada: '21:01' },
  ])('rechaza plan inválido %j', (override) => {
    expect(() => manualPracticePlan({ ...base, ...override })).toThrow();
  });
  it('un rango manual no impone un límite comercial adicional de semanas', () => {
    const p = manualPracticePlan({ ...base, fechaFin: '2029-01-01' });
    expect(p.fechaFinElegida).toBe('2029-01-01');
    expect(p.semanas).toBe(1);
    expect(p.dias).toBeGreaterThan(500);
  });
  it('horas por día: 1 y 6 válidas; 7 rechazada con field y mensaje en español', () => {
    expect(manualPracticePlan({ ...base, horasPorDia: 1 }).bloques).toBe(5);
    expect(manualPracticePlan({ ...base, horasPorDia: 6 }).bloques).toBe(30);
    expect(() => manualPracticePlan({ ...base, horasPorDia: 7 })).toThrow(
      expect.objectContaining({
        message: 'Las horas por día deben ser un entero entre 1 y 6.',
        field: 'practice.horasPorDia',
        code: 'INVALID_FIELD',
      }),
    );
  });
  it('hora fuera de 06:00-22:00 o que no cabe: mensajes con field', () => {
    expect(() => manualPracticePlan({ ...base, horaDeseada: '05:59' })).toThrow(
      expect.objectContaining({ field: 'practice.horaDeseada',
        message: 'La hora deseada debe estar entre 06:00 y 22:00.' }),
    );
    expect(() => manualPracticePlan({ ...base, horaDeseada: '17:00', horasPorDia: 6 })).toThrow(
      expect.objectContaining({ field: 'practice.horaDeseada' }),
    );
    expect(manualPracticePlan({ ...base, horaDeseada: '16:00', horasPorDia: 6 }).dias).toBe(5);
  });
  it('fecha final anterior al inicio y fecha inexistente indican su campo', () => {
    expect(() => manualPracticePlan({ ...base, fechaFin: '2026-09-29' })).toThrow(
      expect.objectContaining({ field: 'practice.fechaFin',
        message: 'La fecha final no puede ser anterior al inicio.' }),
    );
    expect(() => manualPracticePlan({ ...base, fechaInicio: '2026-02-30' })).toThrow(
      expect.objectContaining({ field: 'practice.fechaInicio' }),
    );
  });
  it('una fecha de inicio pasada NO se rechaza (decisión del dueño: el admin elige libremente)', () => {
    expect(manualPracticePlan({ ...base, fechaInicio: '2020-01-06' }).dias).toBe(5);
    expect(manualPracticePlan({ ...base, fechaInicio: '2000-03-01' }).primerDiaEfectivo).toBe('2000-03-01');
  });
});
