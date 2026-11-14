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

import { verifySupabaseJwt } from '../../src/config/jwks';

import { createApp } from '../../src/app';
import { mailer } from '../../src/config/mailer';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';
import { signSolicitudToken } from '../../src/utils/solicitudToken';
import { dataRpcCalls } from '../helpers/rpcCalls';

const mockedRpc = supabaseAdmin.rpc as jest.Mock;
const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedStorageFrom = supabaseAdmin.storage.from as jest.Mock;
const mockedCreateUser = supabaseAdmin.auth.admin.createUser as jest.Mock;
const mockedDeleteUser = supabaseAdmin.auth.admin.deleteUser as jest.Mock;
const mockedSendMail = mailer.sendMail as jest.Mock;
const mockedVerifySupabaseJwt = verifySupabaseJwt as unknown as jest.Mock;

const solicitudId = '11111111-1111-4111-8111-111111111111';
const docId = '33333333-3333-4333-8333-333333333333';
// mockAuthToken siempre resuelve sub: 'test-user-id'.
const adminId = 'test-user-id';
const newStudentId = '44444444-4444-4444-8444-444444444444';
const courseId = '55555555-5555-4555-8555-555555555555';
const cohortId = '66666666-6666-4666-8666-666666666666';

function buildSolicitud(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: solicitudId,
    enviada_at:'2026-10-01T12:00:00Z',
    course_id: courseId,
    cedula: '1710034065',
    nombre_completo: 'Ana Torres',
    telefono: '0991234567',
    correo: 'ana@example.com',
    fecha_nacimiento: '1995-05-20',
    correo_verificado: true,
    codigo_verificacion: null,
    codigo_expira_at: null,
    estado: 'pendiente_revision',
    motivo_rechazo: null,
    reviewed_by: null,
    reviewed_at: null,
    student_id: null,
    solicitada_at: '2026-01-05T12:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function adminAuth(): string {
  return `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`;
}

describe('solicitudes de inscripción (admin)', () => {
  const app = createApp();
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedRpc.mockReset().mockImplementation((name:string,args:Record<string,unknown>)=>Promise.resolve({data:name==='revisar_documento_solicitud'?{id:docId,estado:args.p_estado}:null,error:null}));
    mockedFrom.mockReset();
    mockedStorageFrom.mockReset();
    mockedCreateUser.mockReset();
    mockedDeleteUser.mockReset().mockResolvedValue({});
    mockedSendMail.mockReset().mockResolvedValue({});
    mockedVerifySupabaseJwt.mockReset();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('protección por autenticación y rol', () => {
    it('GET sin token responde 401', async () => {
      const res = await request(app).get('/admin/solicitudes');
      expect(res.status).toBe(401);
    });

    it.each(['instructor'] as const)('GET con rol %s responde 403', async (role) => {
      const res = await request(app)
        .get('/admin/solicitudes')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, role)}`);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('un token de solicitud (postulante) NO sirve como token de admin', async () => {
      mockedVerifySupabaseJwt.mockRejectedValueOnce(new Error('firma inválida'));

      const res = await request(app)
        .get('/admin/solicitudes')
        .set('Authorization', `Bearer ${signSolicitudToken(solicitudId)}`);

      expect(res.status).toBe(401);
    });
  });

  describe('GET /admin/solicitudes', () => {
    it('valida estado y paginación', async () => {
      for (const query of ['estado=inexistente', 'page=0', 'pageSize=101']) {
        expect((await request(app).get(`/admin/solicitudes?${query}`).set('Authorization', adminAuth())).status).toBe(400);
      }
    });
    it('devuelve una página vacía con metadatos (la lista sale de listar_solicitudes_admin)', async () => {
      mockedRpc.mockResolvedValueOnce({ data: { items: [], total: 0, page: 1, pageSize: 20 }, error: null });
      const res = await request(app).get('/admin/solicitudes').set('Authorization', adminAuth());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
      expect(mockedStorageFrom).not.toHaveBeenCalled();
    });
    it('pasa estado, búsqueda y paginación a la función SQL sin firmar documentos', async () => {
      const lista = { items: [{ id: solicitudId, estado: 'enviada' }], total: 21, page: 2, pageSize: 20 };
      mockedRpc.mockResolvedValueOnce({ data: lista, error: null });
      const res = await request(app).get('/admin/solicitudes?page=2&q=Ana&estado=enviada').set('Authorization', adminAuth());
      expect(res.status).toBe(200);
      expect(mockedRpc).toHaveBeenCalledWith('listar_solicitudes_admin', {
        p_estado: 'enviada',
        p_q: 'Ana',
        p_page: 2,
        p_size: 20,
      });
      expect(res.body).toEqual(lista);
      expect(mockedStorageFrom).not.toHaveBeenCalled();
    });
  });

  // TODO(F23): mock desfasado de solicitudAdmin; reescribir contra POST /admin/solicitudes/:id/verificaciones
  // y POST /admin/solicitudes/:id/decision. La revisión por documento (PATCH .../documentos/:docId) y la
  // decisión por PATCH /admin/solicitudes/:id se retiraron con el rediseño del flujo final.
  describe.skip('PATCH /admin/solicitudes/:id/documentos/:docId', () => {
    const url = `/admin/solicitudes/${solicitudId}/documentos/${docId}`;

    it('responde 400 con un estado inválido', async () => {
      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'recibido' });
      expect(res.status).toBe(400);
    });

    it('rechaza un documento con motivo', async () => {
      const updateChain = createChain({ data: { id: docId,estado:'recibido' }, error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'rechazado', motivoRechazo: 'Foto borrosa' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: docId, estado: 'rechazado' });
      expect(mockedRpc).toHaveBeenCalledWith('revisar_documento_solicitud',{p_solicitud:solicitudId,p_documento:docId,p_actor:adminId,p_estado:'rechazado',p_motivo:'Foto borrosa'});

    });

    it('aprobar limpia el motivo de rechazo', async () => {
      const updateChain = createChain({ data: { id: docId,estado:'recibido' }, error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'aprobado', motivoRechazo: 'ignorado' });

      expect(res.status).toBe(200);
      expect(mockedRpc).toHaveBeenCalledWith('revisar_documento_solicitud',expect.objectContaining({p_estado:'aprobado'}));

    });

    it('responde 404 si el documento no pertenece a la solicitud', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'aprobado' });

      expect(res.status).toBe(404);
    });

    it.each(['rechazada'])('responde SOLICITUD_CERRADA si la solicitud está %s', async (estado) => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: buildSolicitud({ estado }), error: null }),
      );

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'aprobado' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SOLICITUD_CERRADA');
      expect(mockedFrom).toHaveBeenCalledTimes(1);
    });

    it('bloquea documentos durante el reclamo de una decisión de solicitud', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud({ reviewed_at: new Date().toISOString() }), error: null }));
      const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'aprobado' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SOLICITUD_CERRADA');
      expect(mockedFrom).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['aprobado', 'aprobado'], ['aprobado', 'rechazado'],
      ['rechazado', 'aprobado'], ['rechazado', 'rechazado'],
    ])('no cambia un documento %s a %s (incluida otra pestaña)', async (previous, estado) => {
      mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(createChain({ data: { id: docId, estado: previous }, error: null }));
      const res = await request(app).patch(url).set('Authorization', adminAuth())
        .send({ estado, motivoRechazo: 'Documento ilegible' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DOCUMENTO_YA_REVISADO');
      expect(dataRpcCalls(mockedRpc)).toHaveLength(0);
      expect(mockedFrom).toHaveBeenCalledTimes(2);
    });
  });

  describe.skip('PATCH /admin/solicitudes/:id (decisión final)', () => {
    const url = `/admin/solicitudes/${solicitudId}`;
    it.each(['aprobada','rechazada'])('un borrador no admite la decisión %s',async estado=>{
      mockedFrom.mockReturnValueOnce(createChain({data:buildSolicitud({enviada_at:null}),error:null}));
      const res=await request(app).patch(url).set('Authorization',adminAuth()).send({estado,motivoRechazo:'Datos incompletos'});
      expect(res.status).toBe(409);expect(res.body.code).toBe('SOLICITUD_NO_ENVIADA');expect(mockedCreateUser).not.toHaveBeenCalled();
    });

    it('responde 400 con un estado inválido', async () => {
      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'pendiente_revision' });
      expect(res.status).toBe(400);
    });

    it('responde 404 si la solicitud no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'rechazada', motivoRechazo: 'Motivo de revisión' });

      expect(res.status).toBe(404);
    });

    it('responde 409 si ya fue resuelta', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: buildSolicitud({ estado: 'rechazada' }), error: null }),
      );

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'aprobada' });

      expect(res.status).toBe(409);
      expect(mockedCreateUser).not.toHaveBeenCalled();
    });

    it('rechaza la solicitud guardando motivo, revisor y fecha; no crea cuenta', async () => {
      const updateChain = createChain({
        data: buildSolicitud({ estado: 'rechazada' }),
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(updateChain).mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'rechazada', motivoRechazo: 'Documentos ilegibles' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: solicitudId,
        estado: 'rechazada',
        studentId: null,
        correoEnviado: true,
      });
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'rechazada',
          motivo_rechazo: 'Documentos ilegibles',
          reviewed_by: adminId,
        }),
      );
      expect(mockedCreateUser).not.toHaveBeenCalled();
    });

    it('exige motivo antes de rechazar', async () => {
      const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'rechazada' });
      expect(res.body.code).toBe('MOTIVO_REQUERIDO');
      expect(mockedFrom).not.toHaveBeenCalled();
    });
    it('conserva rechazo si falla el correo', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(createChain({ data: buildSolicitud({ estado: 'rechazada' }), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));
      mockedSendMail.mockRejectedValueOnce(new Error('SMTP'));
      const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'rechazada', motivoRechazo: 'Revisar documentos' });
      expect(res.status).toBe(200);
      expect(res.body.correoEnviado).toBe(false);
    });
    describe('aprobación', () => {
      const consent = { id: 'consent', acepto_tratamiento: true, declara_veracidad: true };
      function mockApproval(withCohort = true, losesClaim = false) {
        const claim = createChain({ data: losesClaim ? null : { id: solicitudId }, error: null });
        const profile = createChain({ data: null, error: null });
        const enrollment = createChain({ data: { id: 'enrollment' }, error: null });
        mockedCreateUser.mockResolvedValue({ data: { user: { id: newStudentId } }, error: null });
        mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
          .mockReturnValueOnce(createChain({ data: consent, error: null })).mockReturnValueOnce(claim);
        if (!losesClaim) {
          mockedFrom.mockReturnValueOnce(profile).mockReturnValueOnce(createChain({ data: withCohort ? [{ id: cohortId, precio: '150', cupo_maximo: 20, fecha_inicio_matricula: '2026-11-01', fecha_fin_matricula: '2026-11-30', fecha_inicio_curso: '2026-12-01', created_at: '2026-01-01' }] : [], error: null }));
          if (withCohort) mockedFrom.mockReturnValueOnce(createChain({ data: [], error: null }));
          mockedFrom.mockReturnValueOnce(enrollment);
        }
        return { claim, profile, enrollment };
      }
      it('crea perfil con nacimiento y finaliza checklist/auditoría por RPC', async () => {
        const { profile, enrollment, claim } = mockApproval();
        const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'aprobada' });
        expect(res.status).toBe(200);
        expect(profile.insert).toHaveBeenCalledWith(expect.objectContaining({ fecha_nacimiento: '1995-05-20', debe_cambiar_password: true }));
        expect(enrollment.insert).toHaveBeenCalledWith(expect.objectContaining({ cohort_id: cohortId, course_id: courseId }));
        expect(claim.is).toHaveBeenCalledWith('reviewed_at', null);
        expect(mockedRpc).toHaveBeenCalledWith('finalizar_aprobacion_solicitud', expect.objectContaining({ p_solicitud: solicitudId, p_actor: adminId, p_enrollment: 'enrollment' }));
        expect(res.body.cohorteAsignada).toEqual({ cohortId, estado: 'activo' });
        expect(mockedSendMail).toHaveBeenCalled();
      });
      it('sin candidata queda pendiente de cohorte', async () => {
        mockApproval(false);
        const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'aprobada' });
        expect(res.body.cohorteAsignada).toEqual({ cohortId: null, estado: 'pendiente_cohorte' });
      });
      it('la aprobación competidora no crea una segunda cuenta', async () => {
        mockApproval(true, true);
        const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'aprobada' });
        expect(res.body.code).toBe('SOLICITUD_CERRADA');
        expect(mockedCreateUser).not.toHaveBeenCalled();
      });
      it('no crea cuenta sin consentimiento', async () => {
        mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null })).mockReturnValueOnce(createChain({ data: null, error: null }));
        const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'aprobada' });
        expect(res.body.code).toBe('CONSENTIMIENTO_REQUERIDO');
        expect(mockedCreateUser).not.toHaveBeenCalled();
      });
      it('un fallo de correo no revierte la aprobación', async () => {
        mockApproval(); mockedSendMail.mockRejectedValueOnce(new Error('SMTP'));
        const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'aprobada' });
        expect(res.status).toBe(200); expect(res.body.correoEnviado).toBe(false);
        expect(mockedDeleteUser).not.toHaveBeenCalled();
      });
      it('recupera una aprobación confirmada aunque se pierda la respuesta RPC', async () => {
        mockApproval(); mockedRpc.mockResolvedValueOnce({ error: { code: 'red' } });
        mockedFrom.mockReturnValueOnce(createChain({ data: { estado: 'aprobada', student_id: newStudentId }, error: null }));
        const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'aprobada' });
        expect(res.status).toBe(200);
        expect(mockedDeleteUser).not.toHaveBeenCalled();
      });
      it('compensa matrícula y Auth si falla la transacción final', async () => {
        mockApproval(); mockedRpc.mockResolvedValueOnce({ error: { code: 'fallo' } });
        mockedFrom.mockReturnValueOnce(createChain({ data: { estado: 'pendiente_revision' }, error: null }));
        mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }))
          .mockReturnValueOnce(createChain({ data: null, error: null }));
        const res = await request(app).patch(url).set('Authorization', adminAuth()).send({ estado: 'aprobada' });
        expect(res.status).toBe(500); expect(mockedDeleteUser).toHaveBeenCalledWith(newStudentId);
      });
    });
  });
});
