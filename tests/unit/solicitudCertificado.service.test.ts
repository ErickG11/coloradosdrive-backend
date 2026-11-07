import { SolicitudService } from '../../src/services/solicitud.service';
import { createChain } from '../helpers/supabaseMock';
import { jpeg } from '../helpers/hostileFiles';

const id = '11111111-1111-4111-8111-111111111111';
const marca = '2026-11-03T15:00:00.123456+00:00';
const rutaRe = new RegExp(
  `^solicitudes/${id}/estudios/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`,
);

function setup(row: Record<string, unknown> = {}, rpc?: jest.Mock) {
  const storage = {
    upload: jest.fn().mockResolvedValue({ data: {}, error: null }),
    remove: jest.fn().mockResolvedValue({ data: [], error: null }),
  };
  const solicitud = {
    id,
    estado: 'borrador',
    correo_verificado: true,
    nivel_estudios: 'decimo_aprobado',
    datos_actualizados_at: marca,
    ...row,
  };
  const db = {
    from: jest.fn().mockReturnValue(createChain({ data: solicitud, error: null })),
    rpc:
      rpc ??
      jest.fn().mockResolvedValue({
        data: {
          id: 'doc-1',
          subtipo: 'certificado_promocion',
          mimeType: 'image/jpeg',
          tamano: 123,
          subidoAt: '2026-11-03T15:01:00Z',
          rutaAnterior: null,
        },
        error: null,
      }),
    storage: { from: jest.fn().mockReturnValue(storage) },
  };
  const service = new SolicitudService(db as never, {} as never, {} as never, {} as never);
  return { service, db, storage };
}
async function file(name = 'cert.jpg', mimetype = 'image/jpeg') {
  return { buffer: await jpeg(), originalname: name, mimetype };
}
const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: unknown) => e as { code?: string; statusCode?: number },
  );

describe('subirCertificado', () => {
  it('sube un objeto con nombre aleatorio, confirma por RPC y devuelve metadatos', async () => {
    const { service, db, storage } = setup();
    const result = await service.subirCertificado(id, await file(), {
      subtipo: 'certificado_promocion',
    });
    const [ruta, , options] = storage.upload.mock.calls[0] as [
      string,
      Buffer,
      { contentType: string; upsert: boolean },
    ];
    expect(ruta).toMatch(rutaRe);
    expect(options).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(db.storage.from).toHaveBeenCalledWith('solicitudes-documentos');
    expect(db.rpc).toHaveBeenCalledWith(
      'guardar_certificado_inscripcion',
      expect.objectContaining({
        p_id: id,
        p_nivel: 'decimo_aprobado',
        p_marca: marca,
        p_subtipo: 'certificado_promocion',
        p_ruta: ruta,
        p_mime: 'image/jpeg',
        p_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
      }),
    );
    expect(storage.remove).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'doc-1',
      tipoDocumento: 'certificado_estudios',
      estado: 'recibido',
      uploadedAt: '2026-11-03T15:01:00Z',
      subtipo: 'certificado_promocion',
      mimeType: 'image/jpeg',
      tamano: 123,
    });
  });
  it('retira el archivo anterior solo después de confirmar el reemplazo', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        id: 'doc-1',
        subtipo: 'certificado_promocion',
        mimeType: 'image/jpeg',
        tamano: 1,
        subidoAt: 'x',
        rutaAnterior: 'solicitudes/viejo.jpg',
      },
      error: null,
    });
    const { service, storage } = setup({}, rpc);
    await service.subirCertificado(id, await file(), { subtipo: 'certificado_promocion' });
    expect(storage.remove).toHaveBeenCalledWith(['solicitudes/viejo.jpg']);
  });
  it('compensa el objeto nuevo y conserva el anterior si la RPC falla', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: 'SI433', message: 'x' } });
    const { service, storage } = setup({}, rpc);
    const error = await failure(
      service.subirCertificado(id, await file(), { subtipo: 'certificado_promocion' }),
    );
    expect(error).toMatchObject({ code: 'DATOS_CAMBIARON', statusCode: 409 });
    const subida = (storage.upload.mock.calls[0] as [string])[0];
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([subida]);
  });
  it('no llama a la RPC si Storage falla', async () => {
    const { service, db, storage } = setup();
    storage.upload.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(
      await failure(
        service.subirCertificado(id, await file(), { subtipo: 'certificado_promocion' }),
      ),
    ).toMatchObject({
      statusCode: 502,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('solo un reemplazo concurrente gana y el perdedor limpia únicamente su objeto', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'd',
          subtipo: 'certificado_promocion',
          mimeType: 'image/jpeg',
          tamano: 1,
          subidoAt: 'x',
          rutaAnterior: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { code: 'SI409', message: 'x' } });
    const { service, storage } = setup({}, rpc);
    const body = { subtipo: 'certificado_promocion' };
    const results = await Promise.allSettled([
      service.subirCertificado(id, await file(), body),
      service.subirCertificado(id, await file(), body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const paths = storage.upload.mock.calls.map((c) => (c as [string])[0]);
    expect(new Set(paths).size).toBe(2);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(paths).toContain((storage.remove.mock.calls[0] as [string[]])[0][0]);
  });
  it.each([
    ['bachiller', 'NIVEL_NO_REQUIERE_ARCHIVO'],
    [null, 'DATOS_REQUERIDOS'],
    ['menos_de_decimo', 'NIVEL_NO_REQUIERE_ARCHIVO'],
  ])('nivel %s no admite archivo (%s) y nada se sube', async (nivel, code) => {
    const { service, db, storage } = setup({ nivel_estudios: nivel });
    expect(
      await failure(service.subirCertificado(id, await file(), { subtipo: 'acta_grado' })),
    ).toMatchObject({ code });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('exige datos guardados antes de aceptar archivos', async () => {
    const { service, storage } = setup({ datos_actualizados_at: null });
    expect(
      await failure(
        service.subirCertificado(id, await file(), { subtipo: 'certificado_promocion' }),
      ),
    ).toMatchObject({
      code: 'DATOS_REQUERIDOS',
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it.each(['enviada', 'aprobada', 'rechazada'])('rechaza el estado %s', async (estado) => {
    const { service, storage } = setup({ estado });
    expect(
      await failure(
        service.subirCertificado(id, await file(), { subtipo: 'certificado_promocion' }),
      ),
    ).toMatchObject({
      code: 'SOLICITUD_CERRADA',
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('acepta devuelta y el subtipo opcional de bachiller reciente', async () => {
    const { service, db } = setup({ estado: 'devuelta', nivel_estudios: 'bachiller_reciente' });
    await service.subirCertificado(id, await file(), { subtipo: 'acta_grado' });
    expect(db.rpc).toHaveBeenCalled();
  });
  it.each([
    [{ subtipo: 'acta_grado' }],
    [{}],
    [{ subtipo: 'certificado_promocion', tipo_documento: 'cedula' }],
    [{ subtipo: ['certificado_promocion'] }],
  ])('rechaza subtipos incompatibles o campos desconocidos %j', async (body) => {
    const { service, storage } = setup();
    expect(await failure(service.subirCertificado(id, await file(), body))).toMatchObject({
      statusCode: 400,
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('un archivo hostil se rechaza antes de tocar Storage', async () => {
    const { service, storage, db } = setup();
    const svg = { buffer: Buffer.from('<svg/>'), originalname: 'a.svg', mimetype: 'image/svg+xml' };
    expect(
      await failure(service.subirCertificado(id, svg, { subtipo: 'certificado_promocion' })),
    ).toMatchObject({
      code: 'ARCHIVO_TIPO_NO_PERMITIDO',
    });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
