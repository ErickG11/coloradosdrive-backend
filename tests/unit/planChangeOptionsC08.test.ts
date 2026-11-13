import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { PlanChangeService } from '../../src/services/planChange.service';
import { cohortError } from '../../src/config/cohortErrors';
import { createChain } from '../helpers/supabaseMock';
const input = {
  modalidad: 'entre_semana' as const,
  fechaInicio: '2026-11-16',
  horasPorDia: 2,
  horaInicio: 6,
};
function service() {
  const from = jest.fn((table: string) =>
    createChain({
      data:
        table === 'app_settings'
          ? { practicas_hora_fin: 10 }
          : { habilitada: true, horas_objetivo: 10 },
      error: null,
    }),
  );
  return new PlanChangeService({ from } as unknown as SupabaseClient<Database>);
}
test('una consulta de opciones respeta el tope configurado y distingue una hora ocupada', async () => {
  const svc = service();
  const preview = jest
    .spyOn(svc, 'preview')
    .mockResolvedValue({
      factible: true,
      franjas: [],
      precioCentavos: 15000,
      serverNow: '2026-11-12T12:00:00Z',
      plan: null,
    });
  preview.mockRejectedValueOnce(cohortError('RESERVA_RECURSO_OCUPADO'));
  const hours = await svc.options('student', 'enrollment', input);
  expect(hours.map((h) => [h.hora, h.factible])).toEqual([
    ['06:00', false],
    ['07:00', true],
    ['08:00', true],
  ]);
  expect(hours[0].motivo?.mensaje).toBeTruthy();
});
test('no convierte un error de permiso en falta de disponibilidad', async () => {
  const svc = service();
  jest.spyOn(svc, 'preview').mockRejectedValue(cohortError('PERMISO_REQUERIDO'));
  await expect(svc.options('student', 'enrollment', input)).rejects.toMatchObject({
    code: 'PERMISO_REQUERIDO',
  });
});
