import type * as SolicitudAuthModule from '../../src/middlewares/solicitudAuth.middleware';
import type * as SupabaseMockModule from '../helpers/supabaseMock';

// Estado persistido simulado; firma y scope del token siguen siendo los reales.
const mockState = { estado: 'borrador' };
jest.mock('../../src/middlewares/solicitudAuth.middleware', () => {
  const actual = jest.requireActual<typeof SolicitudAuthModule>(
    '../../src/middlewares/solicitudAuth.middleware',
  );
  const { createChain } = jest.requireActual<typeof SupabaseMockModule>('../helpers/supabaseMock');
  return {
    ...actual,
    authenticateSolicitud: actual.createSolicitudAuth({
      from: () =>
        createChain({ data: { estado: mockState.estado, correo_verificado: true }, error: null }),
    } as unknown as Parameters<typeof actual.createSolicitudAuth>[0]),
  };
});
const mockReserve = jest.fn<undefined, [unknown, unknown, (e?: unknown) => void]>();
jest.mock('../../src/middlewares/enrollmentLimits.middleware', () => ({
  reserveEnrollmentCodeIp: (_q: unknown, _s: unknown, next: () => void) => {
    next();
  },
  reserveEnrollmentCode: (_q: unknown, _s: unknown, next: () => void) => {
    next();
  },
  reserveEnrollmentUpload: (req: unknown, res: unknown, next: (e?: unknown) => void) => {
    mockReserve(req, res, next);
  },
}));
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(), storage: { from: jest.fn() } },
  supabaseAnon: {},
}));
jest.mock('../../src/config/mailer', () => ({ mailer: { sendMail: jest.fn() } }));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));

import request from 'supertest';
import { createApp } from '../../src/app';
import { SolicitudService } from '../../src/services/solicitud.service';
import { AppError } from '../../src/utils/AppError';
import { signSolicitudToken } from '../../src/utils/solicitudToken';
import { jpeg } from '../helpers/hostileFiles';

const id = '11111111-1111-4111-8111-111111111111';
const otra = '22222222-2222-4222-8222-222222222222';
const app = createApp();
const bearer = (solicitud = id, scope: 'edicion' | 'estado' = 'edicion') =>
  `Bearer ${signSolicitudToken(solicitud, undefined, scope)}`;
const subir = (buffer: Buffer, name = 'c.jpg', type = 'image/jpeg', auth = bearer()) =>
  request(app)
    .post(`/solicitudes/${id}/documentos`)
    .set('Authorization', auth)
    .field('subtipo', 'certificado_promocion')
    .attach('archivo', buffer, { filename: name, contentType: type });
let service: jest.SpyInstance;

beforeEach(() => {
  mockState.estado = 'borrador';
  mockReserve.mockReset().mockImplementation((_q, _s, next) => {
    next();
  });
  service = jest.spyOn(SolicitudService.prototype, 'subirCertificado').mockResolvedValue({
    id: 'doc',
    tipoDocumento: 'certificado_estudios',
    estado: 'recibido',
    uploadedAt: '2026-11-03T00:00:00Z',
  });
});
afterEach(() => jest.restoreAllMocks());

describe('POST /solicitudes/:id/documentos', () => {
  it('entrega el archivo y el subtipo al servicio y responde 201', async () => {
    const res = await subir(await jpeg());
    expect(res.status).toBe(201);
    const [calledId, file, body] = service.mock.calls[0] as [
      string,
      { originalname: string; mimetype: string; buffer: Buffer },
      unknown,
    ];
    expect(calledId).toBe(id);
    expect(file).toMatchObject({ originalname: 'c.jpg', mimetype: 'image/jpeg' });
    expect(Buffer.isBuffer(file.buffer)).toBe(true);
    expect(body).toMatchObject({ subtipo: 'certificado_promocion' });
    expect(mockReserve).toHaveBeenCalledTimes(1);
  });
  it('cuenta el intento aunque el archivo sea inválido', async () => {
    service.mockRejectedValue(new AppError('x', 400, { code: 'ARCHIVO_INVALIDO' }));
    const res = await subir(Buffer.from('no es imagen'));
    expect(res.status).toBe(400);
    expect(mockReserve).toHaveBeenCalledTimes(1);
  });
  it('con el tope agotado responde 429 CUPO_DIARIO_AGOTADO sin leer ni procesar el archivo', async () => {
    mockReserve.mockImplementation((_q, _s, next) => {
      next(new AppError('cupo', 429, { code: 'CUPO_DIARIO_AGOTADO' }));
    });
    const res = await subir(await jpeg());
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('CUPO_DIARIO_AGOTADO');
    expect(service).not.toHaveBeenCalled();
  });
  it('rechaza con 413 un cuerpo declarado mayor a 2 MiB más el margen, sin llegar al servicio', async () => {
    // El servidor responde y cierra antes de leer el cuerpo: el cliente puede ver 413 o un reinicio.
    const outcome = await subir(Buffer.alloc(3 * 1024 * 1024, 1)).then(
      (res) => ({ status: res.status, code: res.body.code as string }),
      (error: unknown) => ({ status: 0, code: (error as { code?: string }).code ?? '' }),
    );
    if (outcome.status === 0) expect(['ECONNRESET', 'EPIPE']).toContain(outcome.code);
    else expect(outcome).toEqual({ status: 413, code: 'ARCHIVO_DEMASIADO_GRANDE' });
    expect(service).not.toHaveBeenCalled();
  });
  it('rechaza con 413 un archivo apenas mayor a 2 MiB aunque el cuerpo quepa en el margen', async () => {
    const res = await subir(Buffer.alloc(2 * 1024 * 1024 + 1, 1));
    expect(res.status).toBe(413);
    expect(service).not.toHaveBeenCalled();
  });
  it('rechaza tipos declarados no permitidos y campos de archivo con otro nombre', async () => {
    const svg = await subir(Buffer.from('<svg/>'), 'a.svg', 'image/svg+xml');
    expect(svg.status).toBe(400);
    expect(svg.body.code).toBe('ARCHIVO_TIPO_NO_PERMITIDO');
    const otroCampo = await request(app)
      .post(`/solicitudes/${id}/documentos`)
      .set('Authorization', bearer())
      .attach('foto', await jpeg(), { filename: 'c.jpg', contentType: 'image/jpeg' });
    expect(otroCampo.status).toBe(400);
    expect(service).not.toHaveBeenCalled();
  });
  it('rechaza más de un archivo y exceso de campos', async () => {
    const buffer = await jpeg();
    const dos = await request(app)
      .post(`/solicitudes/${id}/documentos`)
      .set('Authorization', bearer())
      .attach('archivo', buffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('archivo', buffer, { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(dos.status).toBe(400);
    const campos = await request(app)
      .post(`/solicitudes/${id}/documentos`)
      .set('Authorization', bearer())
      .field('a', '1')
      .field('b', '2')
      .field('c', '3')
      .attach('archivo', buffer, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(campos.status).toBe(400);
    expect(service).not.toHaveBeenCalled();
  });
  it('responde 400 si falta el archivo', async () => {
    const res = await request(app)
      .post(`/solicitudes/${id}/documentos`)
      .set('Authorization', bearer())
      .field('subtipo', 'certificado_promocion');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ARCHIVO_INVALIDO');
  });
});

describe('autorización de la subida', () => {
  it('sin token: 401 y no cuenta ni procesa', async () => {
    const res = await request(app)
      .post(`/solicitudes/${id}/documentos`)
      .attach('archivo', await jpeg(), { filename: 'c.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
    expect(mockReserve).not.toHaveBeenCalled();
  });
  it('token de otra solicitud: 403', async () => {
    const res = await subir(await jpeg(), 'c.jpg', 'image/jpeg', bearer(otra));
    expect(res.status).toBe(403);
    expect(mockReserve).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });
  it('token de solo lectura: 403', async () => {
    const res = await subir(await jpeg(), 'c.jpg', 'image/jpeg', bearer(id, 'estado'));
    expect(res.status).toBe(403);
    expect(service).not.toHaveBeenCalled();
  });
  it.each(['enviada', 'aprobada', 'rechazada'])(
    'estado %s: 409 sin contar el intento',
    async (estado) => {
      mockState.estado = estado;
      const res = await subir(await jpeg());
      expect(res.status).toBe(409);
      expect(mockReserve).not.toHaveBeenCalled();
      expect(service).not.toHaveBeenCalled();
    },
  );
  it('un token de admin o de estudiante no sirve: no es token de solicitud', async () => {
    const res = await subir(
      await jpeg(),
      'c.jpg',
      'image/jpeg',
      'Bearer eyJhbGciOiJIUzI1NiJ9.e30.firma',
    );
    expect(res.status).toBe(401);
  });
});
