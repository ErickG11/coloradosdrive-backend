import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import {
  StudentDocumentsService,
  PHYSICAL_DOCUMENT_MAPPING,
} from '../../src/services/studentDocuments.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';
function service(results: { data: unknown; error: unknown }[]) {
  const from = createSupabaseFromMock(results);
  return {
    from,
    service: new StudentDocumentsService({ from } as unknown as SupabaseClient<Database>),
  };
}
it('lista solo documentos propios, con estados y entrega física independiente', async () => {
  const h = service([
    { data: { activo: true, fecha_nacimiento: '1950-01-01' }, error: null },
    { data: { id: 'own', estado: 'aprobada' }, error: null },
    {
      data: [{ tipo_documento: 'cedula', estado: 'aprobado', uploaded_at: '2026-10-01' }],
      error: null,
    },
    { data: [{ id: 'e' }], error: null },
    { data: [{ tipo: 'cedula', estado: 'pendiente' }], error: null },
  ]);
  const result = await h.service.get('student');
  expect(result.documentos).toHaveLength(4);
  expect(result.documentos[0]).toMatchObject({
    estado: 'aprobado',
    estadoFisico: 'pendiente',
    obligatorio: true,
  });
  expect(result.documentos[1].exento).toBe(true);
  expect(h.from.mock.results[1].value.eq).toHaveBeenCalledWith('student_id', 'student');
  expect(h.from.mock.results[2].value.eq).toHaveBeenCalledWith('solicitud_id', 'own');
  expect(Object.values(PHYSICAL_DOCUMENT_MAPPING)).toHaveLength(4);
});
it('sin solicitud vinculada conserva los cuatro estados sin permitir subidas', async () => {
  const h = service([
    { data: { activo: true }, error: null },
    { data: null, error: null },
    { data: [], error: null },
  ]);
  const r = await h.service.get('student');
  expect(r.puedeSubir).toBe(false);
  expect(r.documentos.every((d) => d.estado === 'sin_subir')).toBe(true);
});
it('bloquea cuenta inactiva antes de consultar expedientes', async () => {
  const h = service([{ data: { activo: false }, error: null }]);
  await expect(h.service.get('student')).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  expect(h.from).toHaveBeenCalledTimes(1);
});
it('bloquea el reemplazo aprobado usando el helper compartido', async () => {
  const h = service([
    { data: { activo: true }, error: null },
    { data: { id: 'own', estado: 'aprobada' }, error: null },
    { data: { id: 'd', estado: 'aprobado' }, error: null },
  ]);
  await expect(
    h.service.upload('student', 'cedula', {
      buffer: Buffer.from('%PDF-x'),
      mimetype: 'application/pdf',
      size: 6,
    }),
  ).rejects.toMatchObject({ code: 'DOCUMENTO_YA_APROBADO' });
});
it.each([Buffer.alloc(0), Buffer.from('no es PDF')])(
  'rechaza archivos inválidos antes de Storage',
  async (buffer) => {
    const h = service([
      { data: { activo: true }, error: null },
      { data: { id: 'own', estado: 'aprobada' }, error: null },
    ]);
    await expect(
      h.service.upload('student', 'cedula', {
        buffer,
        mimetype: 'application/pdf',
        size: buffer.length,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  },
);
