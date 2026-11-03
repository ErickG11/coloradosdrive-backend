import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { SolicitudDeletionService } from '../../src/services/solicitudDeletion.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';
it('no elimina una solicitud aprobada', async () => {
  const from = createSupabaseFromMock([{ data: { estado: 'aprobada', enviada_at:'2026-10-01' }, error: null }]);
  await expect(new SolicitudDeletionService({ from } as unknown as SupabaseClient<Database>).remove('s', 'a')).rejects.toMatchObject({ code: 'SOLICITUD_CERRADA' });
});
it('retira Storage antes de confirmar borrado y auditoría', async () => {
  const from = createSupabaseFromMock([{ data: { estado: 'pendiente_revision', enviada_at:'2026-10-01', reviewed_at: null }, error: null }, { data: { id: 's' }, error: null }, { data: [{ storage_path: 'ruta' }], error: null }]);
  const remove = jest.fn().mockResolvedValue({ error: null });
  const rpc = jest.fn().mockImplementation(() => { expect(remove).toHaveBeenCalledWith(['ruta']); return Promise.resolve({ error: null }); });
  await new SolicitudDeletionService({ from, rpc, storage: { from: () => ({ remove }) } } as unknown as SupabaseClient<Database>).remove('s', 'a');
  expect(rpc).toHaveBeenCalledWith('eliminar_solicitud_reclamada', expect.objectContaining({ p_solicitud: 's', p_actor: 'a' }));
});
it('no elimina filas si Storage falla', async () => {
  const from = createSupabaseFromMock([{ data: { estado: 'rechazada', enviada_at:'2026-10-01', reviewed_at: 'antes' }, error: null }, { data: { id: 's' }, error: null }, { data: [{ storage_path: 'ruta' }], error: null }, { data: null, error: null }]);
  const rpc = jest.fn();
  const remove = jest.fn().mockResolvedValue({ error: { code: 'fallo' } });
  await expect(new SolicitudDeletionService({ from, rpc, storage: { from: () => ({ remove }) } } as unknown as SupabaseClient<Database>).remove('s', 'a')).rejects.toMatchObject({ statusCode: 502 });
  expect(rpc).not.toHaveBeenCalled();
});
