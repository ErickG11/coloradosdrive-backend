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
  reserveEnrollmentUpload:(_req:unknown,_res:unknown,next:()=>void)=>{next();},
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
    // Contrato vigente: nombres, apellidos, nacionalidadTipo y tipoSangre separados; teléfono local.
    const datos = {
      nombres: 'Ana',
      apellidos: 'Torres',
      cedula: VALID_CEDULA,
      fechaNacimiento: '1995-05-20',
      telefono: '0991234567',
      nacionalidadTipo: 'ecuatoriana',
      tipoSangre: 'no_sabe',
    };
    const consentimientoVigente = () =>
      createChain({
        data: { id: 'consent', acepto_tratamiento: true, declara_veracidad: true, acepto_terminos: true },
        error: null,
      });
    const curso = () => createChain({ data: { edad_minima: 18 }, error: null });

    it('exige token y valida la cédula antes de guardar nada', async () => {
      expect((await request(app).put(`/solicitudes/${solicitudId}/datos`).send(datos)).status).toBe(401);
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud({ estado: 'borrador' }), error: null }))
        .mockReturnValueOnce(consentimientoVigente())
        .mockReturnValueOnce(curso());
      const invalid = await request(app)
        .put(`/solicitudes/${solicitudId}/datos`)
        .set('Authorization', bearer())
        .send({ ...datos, cedula: '1710034064' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.code).toBe('CEDULA_INVALIDA');
      expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('guardar_datos_inscripcion', expect.anything());
    });
    it('rechaza ausencia de consentimiento', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud({ estado: 'borrador' }), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));
      const res = await request(app).put(`/solicitudes/${solicitudId}/datos`).set('Authorization', bearer()).send(datos);
      expect(res.body.code).toBe('CONSENTIMIENTO_REQUERIDO');
    });
    it('rechaza con 409 una solicitud que ya no admite cambios', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud({ estado: 'enviada' }), error: null }));
      const res = await request(app).put(`/solicitudes/${solicitudId}/datos`).set('Authorization', bearer()).send(datos);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SOLICITUD_CERRADA');
    });
    it('guarda los datos por la RPC atómica con la lista explícita de campos', async () => {
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValueOnce({ data: { id: solicitudId }, error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud({ estado: 'borrador' }), error: null }))
        .mockReturnValueOnce(consentimientoVigente())
        .mockReturnValueOnce(curso());
      const res = await request(app).put(`/solicitudes/${solicitudId}/datos`).set('Authorization', bearer()).send(datos);
      expect(res.status).toBe(200);
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        'guardar_datos_inscripcion',
        expect.objectContaining({
          p_id: solicitudId,
          p_datos: expect.objectContaining({ nombres: 'Ana', apellidos: 'Torres', cedula: VALID_CEDULA }),
        }),
      );
      const enviado = (supabaseAdmin.rpc as jest.Mock).mock.calls[0][1] as { p_datos: object };
      expect(enviado.p_datos).not.toHaveProperty('nombreCompleto');
    });
  });

});
