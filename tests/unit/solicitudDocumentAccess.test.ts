import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { SolicitudDocumentAccessService } from '../../src/services/solicitudAudit.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';
it('firma solo un documento del expediente y registra acceso primero', async () => {
  const from = createSupabaseFromMock([{ data: { storage_path: 'ruta' }, error: null }, { data: null, error: null }]);
  const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.invalid/document' }, error: null });
  const db = { from, storage: { from: jest.fn(() => ({ createSignedUrl })) } } as unknown as SupabaseClient<Database>;
  expect(await new SolicitudDocumentAccessService(db).url('s', 'd', 'admin')).toMatchObject({ expiresIn: 300 });
  expect(createSignedUrl).toHaveBeenCalledWith('ruta', 300);
  expect(from.mock.results[0].value.eq).toHaveBeenCalledWith('solicitud_id', 's');
});
it('no firma si falla la auditoría', async () => {
  const from = createSupabaseFromMock([{ data: { storage_path: 'ruta' }, error: null }, { data: null, error: { code: 'fallo' } }]);
  const storage = { from: jest.fn() };
  await expect(new SolicitudDocumentAccessService({ from, storage } as unknown as SupabaseClient<Database>).url('s', 'd', 'a')).rejects.toMatchObject({ code: 'AUDITORIA_NO_DISPONIBLE' });
  expect(storage.from).not.toHaveBeenCalled();
});
