import type * as SolicitudAuthModule from '../../src/middlewares/solicitudAuth.middleware';
import type * as SupabaseMockModule from '../helpers/supabaseMock';
// Fixture independiente para la lectura de estado del middleware; conserva firma/scope reales.
// La matriz completa y el estado persistido se prueban en solicitudScope.test.ts.
jest.mock('../../src/middlewares/solicitudAuth.middleware',()=>{
  const actual=jest.requireActual<typeof SolicitudAuthModule>('../../src/middlewares/solicitudAuth.middleware');
  const {createChain}=jest.requireActual<typeof SupabaseMockModule>('../helpers/supabaseMock');
  return {...actual,authenticateSolicitud:actual.createSolicitudAuth({from:()=>createChain({data:{estado:'borrador',correo_verificado:true},error:null})} as unknown as Parameters<typeof actual.createSolicitudAuth>[0])};
});
// Límites persistentes tienen su propia suite con RPC reales en memoria.
jest.mock('../../src/middlewares/enrollmentLimits.middleware',()=>({
  reserveEnrollmentCodeIp:(_req:unknown,_res:unknown,next:()=>void)=>{next();},
  reserveEnrollmentCode:(_req:unknown,_res:unknown,next:()=>void)=>{next();},
}));
import { createHash } from 'node:crypto';

import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
    storage: { from: jest.fn() },
    auth: { admin: { createUser: jest.fn(), deleteUser: jest.fn() } },
  },
  supabaseAnon: {},
}));

jest.mock('../../src/config/mailer', () => ({
  mailer: { sendMail: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../../src/config/jwks', () => ({
  verifySupabaseJwt: jest.fn(),
}));

import { createApp } from '../../src/app';
import { mailer } from '../../src/config/mailer';
import { supabaseAdmin } from '../../src/config/supabase';
import { signSolicitudToken, verifySolicitudToken } from '../../src/utils/solicitudToken';
import { AppError } from '../../src/utils/AppError';
import { SolicitudPrivacyService } from '../../src/services/solicitudPrivacy.service';
import { createChain } from '../helpers/supabaseMock';

const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedStorageFrom = supabaseAdmin.storage.from as jest.Mock;
const mockedSendMail = mailer.sendMail as jest.Mock;

const solicitudId = '11111111-1111-4111-8111-111111111111';
const otraSolicitudId = '99999999-9999-4999-8999-999999999999';
const courseId = '55555555-5555-4555-8555-555555555555';
const VALID_CEDULA = '1710034065';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bearer(id = solicitudId): string {
  return `Bearer ${signSolicitudToken(id)}`;
}

function buildSolicitud(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: solicitudId,
    course_id: courseId,
    cedula: null,
    nombre_completo: null,
    telefono: null,
    correo: 'ana@example.com',
    fecha_nacimiento: null,
    correo_verificado: true,
    codigo_verificacion: null,
    codigo_expira_at: null,
    intentos_codigo: 0,
    estado: 'pendiente_revision',
    motivo_rechazo: null,
    reviewed_by: null,
    reviewed_at: null,
    student_id: null,
    solicitada_at: overrides.cedula ? '2026-01-02T12:00:00Z' : null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const validDatos = {
  cedula: VALID_CEDULA,
  nombreCompleto: 'Ana Torres',
  telefono: '0991234567',
  fechaNacimiento: '1995-05-20',
};

function mockStorage() {
  const storage = {
    upload: jest.fn().mockResolvedValue({ data: {}, error: null }),
    remove: jest.fn().mockResolvedValue({ data: [], error: null }),
  };
  mockedStorageFrom.mockReturnValue(storage);
  return storage;
}

describe('solicitudes de inscripción (público)', () => {
  const app = createApp();

  beforeEach(() => {
    (supabaseAdmin.rpc as jest.Mock).mockReset().mockResolvedValue({data:false,error:null});
    mockedFrom.mockReset();
    mockedStorageFrom.mockReset();
    mockedSendMail.mockReset().mockResolvedValue({});
  });

  describe('POST /solicitudes/verificar-correo',()=>{
    it('responde 400 con un correo inválido',async()=>{
      const res=await request(app).post('/solicitudes/verificar-correo').send({correo:'no-es-correo'});
      expect(res.status).toBe(400);expect(mockedFrom).not.toHaveBeenCalled();
    });
    it('crea con presupuesto, guarda HASH y envía el mismo código',async()=>{
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{emitir:true,id:solicitudId,correo:'ana@example.com'},error:null});
      const res=await request(app).post('/solicitudes/verificar-correo').send({correo:' Ana@Example.com ',courseId});
      expect(res.status).toBe(200);expect(mockedSendMail).toHaveBeenCalledTimes(1);
      const code=/: (\d{6})/.exec((mockedSendMail.mock.calls[0][0] as {text:string}).text)?.[1]??'';
      const args=(supabaseAdmin.rpc as jest.Mock).mock.calls[0][1];
      expect(args.p_codigo_hash).toBe(sha256(code));expect(args).not.toHaveProperty('codigo');
      expect(args.p_topes.solicitudes).toBe(150);expect(args.p_correo).toBe('ana@example.com');
    });
    it('reutiliza expediente y su dirección original al enviar OTP',async()=>{
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{emitir:true,id:solicitudId,correo:'original@example.com'},error:null});
      await request(app).post('/solicitudes/verificar-correo').send({correo:'ana@example.com',courseId});
      expect(mockedSendMail).toHaveBeenCalledWith(expect.objectContaining({to:'original@example.com'}));
    });
    it('cuenta sin solicitud conserva éxito sin código',async()=>{
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{emitir:false},error:null});
      expect((await request(app).post('/solicitudes/verificar-correo').send({correo:'ana@example.com',courseId})).status).toBe(200);
      expect(mockedSendMail).not.toHaveBeenCalled();
    });
    it('conserva éxito aunque falle correo',async()=>{
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{emitir:true,correo:'ana@example.com'},error:null});
      mockedSendMail.mockRejectedValueOnce(new Error('SMTP ficticio'));
      expect((await request(app).post('/solicitudes/verificar-correo').send({correo:'ana@example.com',courseId})).status).toBe(200);
    });
  });
  it('curso inexistente conserva éxito sin correo',async()=>{
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{emitir:false},error:null});
    const res=await request(app).post('/solicitudes/verificar-correo').send({correo:'ana@example.com',courseId});
    expect(res.status).toBe(200);expect(mockedSendMail).not.toHaveBeenCalled();
  });
  it('no actualiza datos/curso desde el cliente al solicitar código',async()=>{
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{emitir:true,correo:'ana@example.com'},error:null});
    await request(app).post('/solicitudes/verificar-correo').send({correo:'ana@example.com',courseId:otraSolicitudId});
    expect(mockedFrom).not.toHaveBeenCalled();
    expect((supabaseAdmin.rpc as jest.Mock).mock.calls[0][1]).not.toHaveProperty('created_at');
  });
  it.each(['estado', 'scope', 'solicitudId'])(
    'rechaza el campo protegido %s antes de emitir o consumir un código', async (campo) => {
      for (const [ruta, cuerpo] of [
        ['verificar-correo', { correo: 'ana@example.com', courseId }],
        ['confirmar-codigo', { correo: 'ana@example.com', codigo: '012345' }],
      ] as const) {
        const res = await request(app).post(`/solicitudes/${ruta}`).send({ ...cuerpo, [campo]: 'aprobada' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('CAMPO_NO_PERMITIDO');
      }
      expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
      expect(mockedSendMail).not.toHaveBeenCalled();
    },
  );
  it('captcha off ignora un token opcional sin validarlo', async () => {
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{emitir:true,correo:'ana@example.com'},error:null});
    const res = await request(app).post('/solicitudes/verificar-correo').send({correo:'ana@example.com',courseId,captchaToken:{ignorado:true}});
    expect(res.status).toBe(200);
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
  });
  describe('POST /solicitudes/confirmar-codigo',()=>{
    it('responde 400 si no tiene seis dígitos',async()=>{
      expect((await request(app).post('/solicitudes/confirmar-codigo').send({correo:'ana@example.com',codigo:'12'})).status).toBe(400);
    });
    it('mismo error para desconocido, vencido y ausente; cuenta cada fallo en SQL',async()=>{
      const messages=new Set<string>();
      for(const correo of ['ana@example.com','vencido@example.com','nadie@example.com']){
        (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{resultado:'invalido'},error:null});
        const res=await request(app).post('/solicitudes/confirmar-codigo').send({correo,codigo:'654321'});
        expect(res.status).toBe(400);messages.add(res.body.message as string);
      }
      expect(messages.size).toBe(1);expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(3);
    });
    it('fallo se registra una vez mediante RPC atómica',async()=>{
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{resultado:'invalido'},error:null});
      const res=await request(app).post('/solicitudes/confirmar-codigo').send({correo:'ana@example.com',codigo:'654321'});
      expect(res.status).toBe(400);expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith('confirmar_codigo_inscripcion',expect.objectContaining({p_codigo_hash:sha256('654321')}));
    });
    it('al décimo fallo responde 429 con límite diario',async()=>{
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{resultado:'limite'},error:null});
      const res=await request(app).post('/solicitudes/confirmar-codigo').send({correo:'ana@example.com',codigo:'654321'});
      expect(res.status).toBe(429);expect(res.body.code).toBe('CUPO_DIARIO_AGOTADO');
    });
    it('tras bloqueo diario incluso código correcto queda bloqueado',async()=>{
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{resultado:'limite'},error:null});
      expect((await request(app).post('/solicitudes/confirmar-codigo').send({correo:'ana@example.com',codigo:'012345'})).status).toBe(429);
    });
    it('código correcto devuelve token de edición sin exponer estado',async()=>{
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({data:{resultado:'valido',id:solicitudId,scope:'edicion'},error:null});
      const res=await request(app).post('/solicitudes/confirmar-codigo').send({correo:'ana@example.com',codigo:'654321'});
      expect(res.status).toBe(200);expect(res.body.solicitudId).toBe(solicitudId);
      expect(verifySolicitudToken(res.body.token as string)).toBe(solicitudId);expect(res.body).not.toHaveProperty('estado');
    });
  });

  describe('PUT /solicitudes/:id/datos', () => {
    it('exige token y valida cédula antes de acceder a los datos', async () => {
      expect((await request(app).put(`/solicitudes/${solicitudId}/datos`).send(validDatos)).status).toBe(401);
      const invalid = await request(app).put(`/solicitudes/${solicitudId}/datos`).set('Authorization', bearer()).send({ ...validDatos, cedula: '1710034064' });
      expect(invalid.status).toBe(400);
      expect(mockedFrom).not.toHaveBeenCalled();
    });
    it('rechaza ausencia de consentimiento', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));
      const res = await request(app).put(`/solicitudes/${solicitudId}/datos`).set('Authorization', bearer()).send(validDatos);
      expect(res.body.code).toBe('CONSENTIMIENTO_REQUERIDO');
    });
    it('guarda datos y conserva la primera fecha sin reescribir created_at', async () => {
      const saved = '2026-09-01T12:00:00Z';
      const update = createChain({ data: { id: solicitudId }, error: null });
      mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud({ solicitada_at: saved }), error: null }))
        .mockReturnValueOnce(createChain({ data: { id: 'consent', acepto_tratamiento: true, declara_veracidad: true }, error: null }))
        .mockReturnValueOnce(createChain({ data: [], error: null })).mockReturnValueOnce(createChain({data:null,error:null})).mockReturnValueOnce(update);
      const res = await request(app).put(`/solicitudes/${solicitudId}/datos`).set('Authorization', bearer()).send(validDatos);
      expect(res.status).toBe(200);
      expect(update.update.mock.calls[0][0]).toMatchObject({ solicitada_at: saved, cedula: VALID_CEDULA });
      expect(update.update.mock.calls[0][0]).not.toHaveProperty('created_at');
      expect(update.is).toHaveBeenCalledWith('reviewed_at', null);
    });
  });

  describe('POST /solicitudes/:id/documentos', () => {
    beforeEach(() => {
      jest.spyOn(SolicitudPrivacyService.prototype, 'requireConsent').mockResolvedValue({
        id: 'consent', solicitud_id: solicitudId, version_aviso: '2026-10-v1', acepto_tratamiento: true,
        declara_veracidad: true, aceptado_at: '2026-01-01', representante_nombre: null, representante_cedula: null, representante_acepta: false,
      });
    });
    afterEach(() => jest.restoreAllMocks());
    it('rechaza documentos sin consentimiento vigente', async () => {
      jest.spyOn(SolicitudPrivacyService.prototype, 'requireConsent').mockRejectedValueOnce(new AppError('Acepta el aviso', 409, { code: 'CONSENTIMIENTO_REQUERIDO' }));
      mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud({ cedula: VALID_CEDULA }), error: null }));
      const res = await request(app).post(`/solicitudes/${solicitudId}/documentos`).set('Authorization', bearer())
        .field('tipo_documento', 'cedula').attach('archivo', Buffer.from('%PDF-1'), { filename: 'd.pdf', contentType: 'application/pdf' });
      expect(res.body.code).toBe('CONSENTIMIENTO_REQUERIDO');
      expect(mockedStorageFrom).not.toHaveBeenCalled();
    });
    // Firmas binarias reales: subirDocumento ya no confía en el
    // Content-Type declarado, así que un contenido de relleno (puros
    // 0x01) no pasaría la detección real y rompería los tests que no
    // están probando esa validación en sí.
    const SIGNATURE_BY_MIME: Partial<Record<string, number[]>> = {
      'image/jpeg': [0xff, 0xd8, 0xff],
      'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
    };

    function fileContent(mime: string, size = 10): Buffer {
      const signature = SIGNATURE_BY_MIME[mime];
      if (!signature) {
        return Buffer.alloc(Math.max(size, 1), 1);
      }
      const buffer = Buffer.alloc(Math.max(size, signature.length), 1);
      Buffer.from(signature).copy(buffer);
      return buffer;
    }

    const upload = (
      id = solicitudId,
      tipo: string | null = 'cedula',
      mime = 'image/jpeg',
      size = 10,
    ) => {
      let req = request(app).post(`/solicitudes/${id}/documentos`).set('Authorization', bearer(id));
      if (tipo) {
        req = req.field('tipo_documento', tipo);
      }
      return req.attach('archivo', fileContent(mime, size), { filename: 'doc', contentType: mime });
    };

    it('responde 401 sin token, sin bufferizar el archivo', async () => {
      const res = await request(app)
        .post(`/solicitudes/${solicitudId}/documentos`)
        .field('tipo_documento', 'cedula')
        .attach('archivo', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(401);
    });

    it('responde 400 con un tipo_documento inválido', async () => {
      const res = await upload(solicitudId, 'pasaporte');
      expect(res.status).toBe(400);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 400 si falta el archivo', async () => {
      const res = await request(app)
        .post(`/solicitudes/${solicitudId}/documentos`)
        .set('Authorization', bearer())
        .field('tipo_documento', 'cedula');
      expect(res.status).toBe(400);
    });

    it('responde 400 con un tipo de archivo no permitido', async () => {
      const res = await upload(solicitudId, 'cedula', 'application/x-msdownload');
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Tipo de archivo no permitido/);
    });

    it('responde 400 si el contenido real no coincide con el mimetype declarado (spoofing)', async () => {
      mockStorage();
      mockedFrom.mockReturnValueOnce(
        createChain({ data: buildSolicitud({ cedula: VALID_CEDULA }), error: null }),
      );

      // Declara ser un JPEG (pasa el filtro de Multer por Content-Type),
      // pero el contenido real no tiene la firma de ningún tipo permitido.
      const res = await request(app)
        .post(`/solicitudes/${solicitudId}/documentos`)
        .set('Authorization', bearer())
        .field('tipo_documento', 'cedula')
        .attach('archivo', Buffer.from('esto no es una imagen real'), {
          filename: 'falso.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Tipo de archivo no permitido/);
    });

    it('responde 413 si el archivo supera 5 MB', async () => {
      const res = await upload(solicitudId, 'cedula', 'image/png', 5 * 1024 * 1024 + 1);
      expect(res.status).toBe(413);
    });

    it('responde 409 si la solicitud todavía no tiene cédula asignada', async () => {
      mockStorage();
      mockedFrom.mockReturnValueOnce(
        createChain({ data: buildSolicitud({ cedula: null }), error: null }),
      );

      const res = await upload();

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/cédula/);
    });

    it('responde 409 si la solicitud ya no está pendiente', async () => {
      mockStorage();
      mockedFrom.mockReturnValueOnce(
        createChain({
          data: buildSolicitud({ cedula: VALID_CEDULA, estado: 'aprobada' }),
          error: null,
        }),
      );

      const res = await upload();

      expect(res.status).toBe(409);
    });

    it('sube al bucket privado y registra el documento con estado recibido', async () => {
      const storage = mockStorage();
      const insertChain = createChain({
        data: {
          id: 'doc-1',
          solicitud_id: solicitudId,
          tipo_documento: 'tipo_sangre',
          storage_path: 'x',
          estado: 'recibido',
          motivo_rechazo: null,
          uploaded_at: '2026-01-02T00:00:00Z',
          reviewed_at: null,
        },
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(
          createChain({ data: buildSolicitud({ cedula: VALID_CEDULA }), error: null }),
        )
        .mockReturnValueOnce(createChain({ data: null, error: null })) // sin documento previo de este tipo
        .mockReturnValueOnce(insertChain);

      const res = await upload(solicitudId, 'tipo_sangre', 'application/pdf');

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: 'doc-1',
        tipoDocumento: 'tipo_sangre',
        estado: 'recibido',
        uploadedAt: '2026-01-02T00:00:00Z',
      });
      expect(mockedStorageFrom).toHaveBeenCalledWith('solicitudes-documentos');
      const [path, , options] = storage.upload.mock.calls[0] as [
        string,
        Buffer,
        Record<string, unknown>,
      ];
      expect(path).toMatch(new RegExp(`^${solicitudId}/tipo_sangre-[0-9a-f-]{36}\\.pdf$`));
      expect(options).toMatchObject({ contentType: 'application/pdf', upsert: false });
      expect(insertChain.insert).toHaveBeenCalledWith({
        solicitud_id: solicitudId,
        tipo_documento: 'tipo_sangre',
        storage_path: path,
      });
    });

    it('volver a subir el mismo tipo (foto borrosa) reemplaza el archivo anterior y reinicia la revisión', async () => {
      const storage = mockStorage();
      const updateChain = createChain({
        data: {
          id: 'doc-1',
          tipo_documento: 'cedula',
          estado: 'recibido',
          uploaded_at: '2026-01-03T00:00:00Z',
        },
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(
          createChain({ data: buildSolicitud({ cedula: VALID_CEDULA }), error: null }),
        )
        .mockReturnValueOnce(
          createChain({
            data: {
              id: 'doc-1',
              estado: 'rechazado',
              storage_path: `${solicitudId}/cedula-viejo.jpg`,
            },
            error: null,
          }),
        )
        .mockReturnValueOnce(updateChain);

      const res = await upload();

      expect(res.status).toBe(201);
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ estado: 'recibido', motivo_rechazo: null, reviewed_at: null, reviewed_by: null }),
      );
      expect(res.body.estado).toBe('recibido');
      expect(updateChain.neq).toHaveBeenCalledWith('estado', 'aprobado');
      expect(updateChain.eq).toHaveBeenCalledWith('storage_path', `${solicitudId}/cedula-viejo.jpg`);
      expect(storage.remove).toHaveBeenCalledWith([`${solicitudId}/cedula-viejo.jpg`]);
    });

    it('no pisa una aprobación ni otra resubida concurrente y compensa solo el archivo nuevo', async () => {
      const storage = mockStorage();
      const update = createChain({ data: null, error: null });
      mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud({ cedula: VALID_CEDULA }), error: null }))
        .mockReturnValueOnce(createChain({ data: { id: 'doc-1', estado: 'rechazado', storage_path: 'anterior.jpg' }, error: null }))
        .mockReturnValueOnce(update);
      const res = await upload();
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DOCUMENTO_YA_REVISADO');
      expect(update.neq).toHaveBeenCalledWith('estado', 'aprobado');
      expect(update.eq).toHaveBeenCalledWith('storage_path', 'anterior.jpg');
      const [uploadedPath] = storage.upload.mock.calls[0] as [string];
      expect(storage.remove).toHaveBeenCalledWith([uploadedPath]);
      expect(storage.remove).not.toHaveBeenCalledWith(['anterior.jpg']);
    });

    it('responde 409 si el documento ya fue aprobado', async () => {
      const storage = mockStorage();
      mockedFrom
        .mockReturnValueOnce(
          createChain({ data: buildSolicitud({ cedula: VALID_CEDULA }), error: null }),
        )
        .mockReturnValueOnce(
          createChain({
            data: { id: 'doc-1', estado: 'aprobado', storage_path: 'x' },
            error: null,
          }),
        );

      const res = await upload();

      expect(res.status).toBe(409);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('si falla el registro en la base, borra el objeto recién subido (sin huérfanos)', async () => {
      const storage = mockStorage();
      mockedFrom
        .mockReturnValueOnce(
          createChain({ data: buildSolicitud({ cedula: VALID_CEDULA }), error: null }),
        )
        .mockReturnValueOnce(createChain({ data: null, error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: { message: 'boom' } }));

      const res = await upload();

      expect(res.status).toBe(500);
      const [uploadedPath] = storage.upload.mock.calls[0] as [string];
      expect(storage.remove).toHaveBeenCalledWith([uploadedPath]);
    });
  });
});
