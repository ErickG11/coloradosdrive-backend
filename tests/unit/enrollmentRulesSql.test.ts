import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
import {
  buildEnrollmentPlan,
  assertFuturePlan,
  cohortCalendar,
} from '../../src/utils/enrollmentRules';

jest.setTimeout(120000);
let db: EmbeddedPostgres;
interface Vector {
  modalidad: 'entre_semana' | 'fin_de_semana';
  horasPorDia: number;
  horaInicio: number;
  fechaInicio: string;
  sesiones: number;
  fin: string;
}
const vectors = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/enrollment-plan-vectors.json'), 'utf8'),
) as Vector[];
beforeAll(async () => {
  db = new EmbeddedPostgres({ btreeGist: true });
  await setupEnrollmentDatabase(db, '070');
});
afterAll(async () => {
  await db?.close();
});
async function sqlPlan(input: object) {
  return (
    await db.query<{
      p: {
        ultimaFecha: string;
        totalHoras: number;
        fechaInicioEfectiva: string;
        dias: { fecha: string; horas: number }[];
        franjas: string[];
      };
    }>('select private.enrollment_plan_v2($1) p', [input])
  ).rows[0].p;
}

test.each(vectors)(
  '15 horas: $modalidad, $horasPorDia horas/día: mismos vectores TS/SQL',
  async (v) => {
    const ts = buildEnrollmentPlan(v, 22, 15);
    const sql = await sqlPlan(v);
    expect(ts.ultimaFecha).toBe(v.fin);
    expect(ts.dias).toHaveLength(v.sesiones);
    expect(ts.dias.reduce((s, d) => s + d.horas, 0)).toBe(15);
    expect(ts.franjas).toHaveLength(15);
    expect(sql).toEqual({
      ultimaFecha: ts.ultimaFecha,
      totalHoras: 15,
      fechaInicioEfectiva: ts.fechaInicioEfectiva,
      dias: ts.dias.map(({ fecha, horas }) => ({ fecha, horas })),
      franjas: ts.franjas,
    });
  },
);

test.each([
  ['2026-11-11T04:59:59.999Z', true],
  ['2026-11-11T05:00:00.000Z', false],
])('cierre 23:59:59 / medianoche siguiente TS/SQL: %s', async (now, open) => {
  const input = {
    enrollmentStart: '2026-11-01',
    enrollmentEnd: '2026-11-15',
    practiceStart: '2026-11-01',
    practiceEnd: '2026-11-30',
    enabled: true,
  };
  const ts = cohortCalendar(input, new Date(now));
  const sql = (
    await db.query<{ v: unknown }>(
      'select private.cohort_calendar_v2($1,$2,$3,$4,$5,$6) v',
      Object.values(input).concat(now as never),
    )
  ).rows[0].v;
  expect(ts.open).toBe(open);
  expect(sql).toEqual(ts);
});

test('inicio hoy con franjas futuras; TS y SQL rechazan una franja comenzada', async () => {
  const input = {
    modalidad: 'entre_semana' as const,
    horasPorDia: 3,
    horaInicio: 6,
    fechaInicio: '2026-11-16',
  };
  const ts = buildEnrollmentPlan(input, 22, 15);
  const sql = await sqlPlan(input);
  assertFuturePlan(ts, new Date('2026-11-16T10:59:59Z'));
  await db.query('select private.assert_enrollment_plan_future($1,$2)', [
    sql,
    '2026-11-16T10:59:59Z',
  ]);
  expect(() => assertFuturePlan(ts, new Date('2026-11-16T11:00:00Z'))).toThrow('hora ya pasó');
  await expect(
    db.query('select private.assert_enrollment_plan_future($1,$2)', [sql, '2026-11-16T11:00:00Z']),
  ).rejects.toThrow('PLAN_FRANJA_PASADA');
  expect(() => assertFuturePlan(ts, new Date('2026-11-17T10:00:00Z'))).toThrow('desde hoy');
  await expect(
    db.query('select private.assert_enrollment_plan_future($1,$2)', [sql, '2026-11-17T10:00:00Z']),
  ).rejects.toThrow('PLAN_INICIO_PASADO');
});

test('cruce de mes/año, último día parcial y reaplicación tras rollback', async () => {
  const input = {
    modalidad: 'entre_semana' as const,
    horasPorDia: 2,
    horaInicio: 6,
    fechaInicio: '2026-12-28',
  };
  const ts = buildEnrollmentPlan(input, 22, 15);
  const sql = await sqlPlan(input);
  expect(ts.ultimaFecha).toBe('2027-01-06');
  expect(sql.ultimaFecha).toBe(ts.ultimaFecha);
  expect(sql.dias.at(-1)?.horas).toBe(1);
  await db.exec(enrollmentSql('docs/operations/inscripcion-070-verificacion.sql'));
  await db.exec(enrollmentSql('docs/operations/inscripcion-070-rollback.sql'));
  await db.exec(enrollmentSql('migrations/070_inscripcion_reglas_calendario.sql'));
  await db.exec(enrollmentSql('docs/operations/inscripcion-070-verificacion.sql'));
  expect(
    (await db.query('select key from public.enrollment_rule_flags where enabled')).rows,
  ).toEqual([]);
});
