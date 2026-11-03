import { createHash } from 'node:crypto';

import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
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
    mockedFrom.mockReset();
    mockedStorageFrom.mockReset();
    mockedSendMail.mockReset().mockResolvedValue({});
  });

  describe('POST /solicitudes/verificar-correo', () => {
    it('responde 400 con un correo inválido', async () => {
      const res = await request(app)
        .post('/solicitudes/verificar-correo')
        .send({ correo: 'no-es-correo' });
      expect(res.status).toBe(400);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('crea la solicitud en progreso, guarda solo el HASH del código y lo envía por correo', async () => {
      const insertChain = createChain({ data: null, error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: null, error: null })) // findByCorreo: no existe
        .mockReturnValueOnce(createChain({ data: { id: courseId }, error: null }))
        .mockReturnValueOnce(insertChain);

      const res = await request(app)
        .post('/solicitudes/verificar-correo')
        .send({ correo: '  Ana@Example.com ', courseId });

      expect(res.status).toBe(200);
      expect(mockedSendMail).toHaveBeenCalledTimes(1);
      const mail = mockedSendMail.mock.calls[0][0] as { to: string; text: string };
      expect(mail.to).toBe('ana@example.com');
      const code = /: (\d{6})/.exec(mail.text)?.[1] ?? '';
      expect(code).toMatch(/^\d{6}$/);

      const inserted = insertChain.insert.mock.calls[0][0] as Record<string, string>;
      expect(inserted.correo).toBe('ana@example.com');
      expect(inserted.codigo_verificacion).toBe(sha256(code));
      expect(inserted.codigo_verificacion).not.toContain(code);
      // Vence en 15 minutos.
      const minutes = (new Date(inserted.codigo_expira_at).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);
    });

    it('reutiliza la solicitud existente del correo (solo renueva el código)', async () => {
      const updateChain = createChain({ data: null, error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(createChain({ data: { id: courseId }, error: null }))
        .mockReturnValueOnce(updateChain);

      const res = await request(app)
        .post('/solicitudes/verificar-correo')
        .send({ correo: 'ana@example.com', courseId });

      expect(res.status).toBe(200);
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ codigo_verificacion: expect.any(String) }),
      );
      // No pisa correo_verificado: un tercero no puede "des-verificar" a alguien.
      expect(updateChain.update.mock.calls[0][0]).not.toHaveProperty('correo_verificado');
    });

    it('responde 409 si ya hay una solicitud aprobada para ese correo', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: buildSolicitud({ estado: 'aprobada' }), error: null }),
      );

      const res = await request(app)
        .post('/solicitudes/verificar-correo')
        .send({ correo: 'ana@example.com', courseId });

      expect(res.status).toBe(409);
      expect(mockedSendMail).not.toHaveBeenCalled();
    });

    it('responde 502 si el correo no se pudo enviar', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: null, error: null }))
        .mockReturnValueOnce(createChain({ data: { id: courseId }, error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));
      mockedSendMail.mockRejectedValueOnce(new Error('smtp caído'));

      const res = await request(app)
        .post('/solicitudes/verificar-correo')
        .send({ correo: 'ana@example.com', courseId });

      expect(res.status).toBe(502);
    });
  });

  it('rechaza un curso inexistente antes de emitir el correo', async () => {
    mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }))
      .mockReturnValueOnce(createChain({ data: null, error: null }));
    const res = await request(app).post('/solicitudes/verificar-correo').send({ correo: 'ana@example.com', courseId });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CURSO_NO_ENCONTRADO');
    expect(mockedSendMail).not.toHaveBeenCalled();
  });
  it('conserva curso y fechas después del primer guardado', async () => {
    const update = createChain({ data: null, error: null });
    mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud({ solicitada_at: '2026-01-02T12:00:00Z' }), error: null }))
      .mockReturnValueOnce(createChain({ data: { id: courseId }, error: null })).mockReturnValueOnce(update);
    const res = await request(app).post('/solicitudes/verificar-correo').send({ correo: 'ana@example.com', courseId: otraSolicitudId });
    expect(res.status).toBe(200);
    expect(update.update.mock.calls[0][0]).toMatchObject({ course_id: courseId });
    expect(update.update.mock.calls[0][0]).not.toHaveProperty('solicitada_at');
    expect(update.update.mock.calls[0][0]).not.toHaveProperty('created_at');
  });
  describe('POST /solicitudes/confirmar-codigo', () => {
    const future = (): string => new Date(Date.now() + 10 * 60_000).toISOString();

    it('responde 400 si el código no tiene 6 dígitos', async () => {
      const res = await request(app)
        .post('/solicitudes/confirmar-codigo')
        .send({ correo: 'ana@example.com', codigo: '12' });
      expect(res.status).toBe(400);
    });

    it('responde 400 con el mismo mensaje si el código no existe o venció (sin consumir un intento)', async () => {
      const cases = [
        buildSolicitud({ codigo_verificacion: null, codigo_expira_at: null }), // sin código
        buildSolicitud({
          codigo_verificacion: sha256('654321'),
          codigo_expira_at: new Date(Date.now() - 1000).toISOString(), // vencido
        }),
      ];
      const messages = new Set<string>();

      for (const row of cases) {
        mockedFrom.mockReturnValueOnce(createChain({ data: row, error: null }));
        const res = await request(app)
          .post('/solicitudes/confirmar-codigo')
          .send({ correo: 'ana@example.com', codigo: '654321' });
        expect(res.status).toBe(400);
        messages.add(res.body.message as string);
      }
      // Correo inexistente.
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));
      const res = await request(app)
        .post('/solicitudes/confirmar-codigo')
        .send({ correo: 'nadie@example.com', codigo: '654321' });
      expect(res.status).toBe(400);
      messages.add(res.body.message as string);

      expect(messages.size).toBe(1);
      // Ninguno de estos casos hace un segundo llamado a .from (no hay
      // intento que contar: no existe código vigente contra el cual fallar).
      expect(mockedFrom).toHaveBeenCalledTimes(3);
    });

    it('si el código no coincide, cuenta el intento fallido y devuelve el mismo mensaje genérico', async () => {
      const updateChain = createChain({ data: { id: solicitudId }, error: null });
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: buildSolicitud({
              codigo_verificacion: sha256('123456'),
              codigo_expira_at: future(),
              intentos_codigo: 2,
            }),
            error: null,
          }),
        )
        .mockReturnValueOnce(updateChain);

      const res = await request(app)
        .post('/solicitudes/confirmar-codigo')
        .send({ correo: 'ana@example.com', codigo: '654321' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Código inválido o vencido');
      expect(updateChain.update).toHaveBeenCalledWith({ intentos_codigo: 3 });
      expect(updateChain.eq).toHaveBeenCalledWith('intentos_codigo', 2);
      expect(updateChain.eq).toHaveBeenCalledWith('codigo_verificacion', sha256('123456'));
      expect(updateChain.gt).toHaveBeenCalledWith('codigo_expira_at', expect.any(String));
    });

    it('al llegar al 5º intento fallido, invalida el código y responde 429 (hay que pedir uno nuevo)', async () => {
      const updateChain = createChain({ data: { id: solicitudId }, error: null });
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: buildSolicitud({
              codigo_verificacion: sha256('123456'),
              codigo_expira_at: future(),
              intentos_codigo: 4,
            }),
            error: null,
          }),
        )
        .mockReturnValueOnce(updateChain);

      const res = await request(app)
        .post('/solicitudes/confirmar-codigo')
        .send({ correo: 'ana@example.com', codigo: '654321' });

      expect(res.status).toBe(429);
      expect(res.body.message).toMatch(/Solicita un nuevo código/);
      expect(updateChain.update).toHaveBeenCalledWith({
        intentos_codigo: 5,
        codigo_verificacion: null,
        codigo_expira_at: null,
      });
    });

    it('tras el bloqueo, incluso el código correcto original ya no sirve (quedó invalidado)', async () => {
      // Simula el estado que deja el test anterior: el código ya fue
      // limpiado por el propio bloqueo.
      mockedFrom.mockReturnValueOnce(
        createChain({
          data: buildSolicitud({
            codigo_verificacion: null,
            codigo_expira_at: null,
            intentos_codigo: 5,
          }),
          error: null,
        }),
      );

      const res = await request(app)
        .post('/solicitudes/confirmar-codigo')
        .send({ correo: 'ana@example.com', codigo: '654321' });

      expect(res.status).toBe(400);
    });

    it('con el código correcto marca el correo verificado, limpia el código y devuelve un token temporal', async () => {
      const updateChain = createChain({ data: { id: solicitudId }, error: null });
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: buildSolicitud({
              correo_verificado: false,
              codigo_verificacion: sha256('654321'),
              codigo_expira_at: future(),
            }),
            error: null,
          }),
        )
        .mockReturnValueOnce(updateChain);

      const res = await request(app)
        .post('/solicitudes/confirmar-codigo')
        .send({ correo: 'ana@example.com', codigo: '654321' });

      expect(res.status).toBe(200);
      expect(res.body.solicitudId).toBe(solicitudId);
      expect(verifySolicitudToken(res.body.token as string)).toBe(solicitudId);
      expect(updateChain.update).toHaveBeenCalledWith({
        correo_verificado: true,
        codigo_verificacion: null,
        codigo_expira_at: null,
        intentos_codigo: 0,
      });
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
        .mockReturnValueOnce(createChain({ data: [], error: null })).mockReturnValueOnce(update);
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
