import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import {
  configuredEnrollmentPlan,
  studentPlanRules,
} from '../../src/services/studentPlanRules.service';
import { createChain } from '../helpers/supabaseMock';
const options = [
  { modalidad: 'entre_semana', horas_por_dia: 1, habilitada: true, horas_objetivo: 10 },
  { modalidad: 'entre_semana', horas_por_dia: 2, habilitada: true, horas_objetivo: 10 },
  { modalidad: 'fin_de_semana', horas_por_dia: 2, habilitada: true, horas_objetivo: 10 },
  { modalidad: 'fin_de_semana', horas_por_dia: 1, habilitada: false, horas_objetivo: 10 },
  { modalidad: 'entre_semana', horas_por_dia: 3, habilitada: false, horas_objetivo: 10 },
];
function mockDb(option: unknown = options[1]) {
  const from = jest.fn((table: string) =>
    createChain({
      data:
        table === 'enrollment_rule_flags'
          ? { enabled: true, implemented: true }
          : table === 'app_settings'
            ? { practicas_hora_fin: 22 }
            : option,
      error: null,
    }),
  );
  return { db: { from } as unknown as SupabaseClient<Database>, from };
}
test('configuración expone solo las tres combinaciones habilitadas con objetivo y días', async () => {
  const { db } = mockDb(options);
  const rules = await studentPlanRules(db);
  expect(rules.options.map((o) => [o.modalidad, o.horasPorDia, o.totalHoras, o.sesiones])).toEqual([
    ['entre_semana', 1, 10, 10],
    ['entre_semana', 2, 10, 5],
    ['fin_de_semana', 2, 10, 5],
  ]);
});
test('el cálculo usa el objetivo habilitado del servidor, también si cambia en el futuro', async () => {
  const { db } = mockDb({ ...options[1], horas_objetivo: 12 });
  expect(
    (
      await configuredEnrollmentPlan(db, {
        modalidad: 'entre_semana',
        horasPorDia: 2,
        horaInicio: 7,
        fechaInicio: '2026-11-16',
      })
    ).totalHoras,
  ).toBe(12);
});
test.each([null, options[3], options[4]])(
  'una combinación inexistente o deshabilitada falla con PLAN_ENTRADA_INVALIDA',
  async (option) => {
    const { db } = mockDb(option);
    await expect(
      configuredEnrollmentPlan(db, {
        modalidad: 'entre_semana',
        horasPorDia: 3,
        horaInicio: 7,
        fechaInicio: '2026-11-16',
      }),
    ).rejects.toMatchObject({ code: 'PLAN_ENTRADA_INVALIDA' });
  },
);

test('expone la oferta sin activar los indicadores apagados', async () => {
  const from = jest.fn((table: string) =>
    createChain({
      data:
        table === 'enrollment_rule_flags'
          ? { enabled: false, implemented: true }
          : table === 'app_settings'
            ? { practicas_hora_fin: 22 }
            : options,
      error: null,
    }),
  );
  const rules = await studentPlanRules({ from } as unknown as SupabaseClient<Database>);
  expect(rules.active).toBe(false);
  expect(rules.options).toHaveLength(3);
});
