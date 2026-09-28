import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import {
  ABANDONED_AFTER_DAYS,
  SolicitudCleanupService,
} from '../../src/services/solicitudCleanup.service';
import { createChain, createSupabaseFromMock } from '../helpers/supabaseMock';

function buildService(from: jest.Mock): SolicitudCleanupService {
  return new SolicitudCleanupService({ from } as unknown as SupabaseClient<Database>);
}

describe('SolicitudCleanupService.purgeAbandoned', () => {
  const now = new Date('2026-06-15T03:00:00.000Z');

  it('no hace nada más si no hay solicitudes viejas en pendiente_revision', async () => {
    const from = createSupabaseFromMock([{ data: [], error: null }]);

    const deleted = await buildService(from).purgeAbandoned(now);

    expect(deleted).toBe(0);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('usa el corte de 7 días sobre pendiente_revision', async () => {
    const oldChain = createChain({ data: [], error: null });
    const from = jest.fn().mockReturnValueOnce(oldChain);

    await buildService(from).purgeAbandoned(now);

    const expectedCutoff = new Date(
      now.getTime() - ABANDONED_AFTER_DAYS * 24 * 60 * 60_000,
    ).toISOString();
    expect(oldChain.eq).toHaveBeenCalledWith('estado', 'pendiente_revision');
    expect(oldChain.lt).toHaveBeenCalledWith('created_at', expectedCutoff);
  });

  it('elimina solo las que no tienen ningún documento; las que sí tienen quedan esperando revisión', async () => {
    const deleteChain = createChain({ data: null, error: null });
    const from = jest
      .fn()
      .mockReturnValueOnce(
        createChain({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null }),
      )
      .mockReturnValueOnce(createChain({ data: [{ solicitud_id: 'b' }], error: null }))
      .mockReturnValueOnce(deleteChain);

    const deleted = await buildService(from).purgeAbandoned(now);

    expect(deleted).toBe(2);
    expect(deleteChain.in).toHaveBeenCalledWith('id', ['a', 'c']);
    // Nunca borra una que ya no esté pendiente.
    expect(deleteChain.eq).toHaveBeenCalledWith('estado', 'pendiente_revision');
  });

  it('no elimina nada si todas las viejas tienen documentos', async () => {
    const from = createSupabaseFromMock([
      { data: [{ id: 'a' }], error: null },
      { data: [{ solicitud_id: 'a' }], error: null },
    ]);

    const deleted = await buildService(from).purgeAbandoned(now);

    expect(deleted).toBe(0);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('propaga el error si la consulta falla', async () => {
    const from = createSupabaseFromMock([{ data: null, error: { message: 'boom' } }]);

    await expect(buildService(from).purgeAbandoned(now)).rejects.toEqual({ message: 'boom' });
  });
});
