import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { SolicitudCleanupService } from '../../src/services/solicitudCleanup.service';
import { SolicitudPurgeService } from '../../src/services/solicitudPurge.service';
import { createChain, createSupabaseFromMock } from '../helpers/supabaseMock';

afterEach(() => jest.restoreAllMocks());

const cliente = (from: jest.Mock) => ({ from }) as unknown as SupabaseClient<Database>;

it('purga las rechazadas anteriores al corte de N días con la acción de retención', async () => {
  const chain = createChain({ data: [{ id: 'vieja' }], error: null });
  const from = jest.fn().mockReturnValue(chain);
  const purge = jest.spyOn(SolicitudPurgeService.prototype, 'purge').mockResolvedValue(true);

  const total = await new SolicitudCleanupService(cliente(from), 30).purgeRejected(
    new Date('2026-02-10T00:00:00Z'),
  );

  expect(total).toBe(1);
  expect(chain.eq).toHaveBeenCalledWith('estado', 'rechazada');
  expect(chain.lt).toHaveBeenCalledWith('reviewed_at', '2026-01-11T00:00:00.000Z');
  expect(purge).toHaveBeenCalledWith('vieja', null, 'purga_retencion');
});

it('purga solo borradores y cuenta únicamente lo que se purgó', async () => {
  const from = createSupabaseFromMock([{ data: [{ id: 'a' }, { id: 'b' }], error: null }]);
  const purge = jest
    .spyOn(SolicitudPurgeService.prototype, 'purge')
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);

  const total = await new SolicitudCleanupService(cliente(from)).purgeDrafts(
    new Date('2026-02-10T00:00:00Z'),
  );

  expect(total).toBe(1);
  expect(purge).toHaveBeenCalledWith('a', null, 'purga_borrador');
  expect(purge).toHaveBeenCalledWith('b', null, 'purga_borrador');
});

it('un elemento que falla no detiene a los demás ni se cuenta', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const from = createSupabaseFromMock([{ data: [{ id: 'falla' }, { id: 'ok' }], error: null }]);
  jest
    .spyOn(SolicitudPurgeService.prototype, 'purge')
    .mockRejectedValueOnce(new Error('x'))
    .mockResolvedValueOnce(true);

  const total = await new SolicitudCleanupService(cliente(from)).purgeRejected(
    new Date('2026-02-10T00:00:00Z'),
  );

  expect(total).toBe(1);
});
