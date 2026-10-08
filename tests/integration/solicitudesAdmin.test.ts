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

import { verifySupabaseJwt } from '../../src/config/jwks';

import { createApp } from '../../src/app';
import { mailer } from '../../src/config/mailer';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';
import { signSolicitudToken } from '../../src/utils/solicitudToken';

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
    it('responde 400 con un estado inválido', async () => {
      const res = await request(app)
        .get('/admin/solicitudes?estado=archivada')
        .set('Authorization', adminAuth());
      expect(res.status).toBe(400);
    });

    it('lista vacía sin consultar documentos', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: [], error: null }));

      const res = await request(app).get('/admin/solicitudes').set('Authorization', adminAuth());

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(mockedFrom).toHaveBeenCalledTimes(1);
    });

    it('arma el checklist con URLs firmadas de corta duración; papeleta "no_aplica" solo si tiene 65+ y no la subió', async () => {
      const solicitudesChain = createChain({
        data: [
          buildSolicitud({ id: 's-mayor', fecha_nacimiento: '1950-01-01' }),
          buildSolicitud({ id: 's-joven', fecha_nacimiento: '2000-01-01' }),
        ],
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(solicitudesChain)
        .mockReturnValueOnce(
          createChain({
            data: [
              {
                id: 'd1',
                solicitud_id: 's-mayor',
                tipo_documento: 'cedula',
                storage_path: 's-mayor/cedula-a.jpg',
                estado: 'recibido',
                motivo_rechazo: null,
                uploaded_at: '2026-01-02T00:00:00Z',
                reviewed_at: null,
              },
              {
                id: 'd2',
                solicitud_id: 's-mayor',
                tipo_documento: 'tipo_sangre',
                storage_path: 's-mayor/sangre-b.pdf',
                estado: 'rechazado',
                motivo_rechazo: 'Ilegible',
                uploaded_at: '2026-01-02T00:00:00Z',
                reviewed_at: '2026-01-03T00:00:00Z',
              },
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          createChain({
            data: [
              {
                id: 's-mayor',
                cedula: '1710034065',
                correo: 'ana@example.com',
                estado: 'pendiente_revision',
                created_at: '2026-01-01T00:00:00Z',
              },
              {
                id: 's-joven',
                cedula: '1710034065',
                correo: 'ana@example.com',
                estado: 'pendiente_revision',
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        ); // solicitudesRelacionadas por cédula (ambas comparten cédula)
      const createSignedUrls = jest.fn().mockResolvedValue({
        data: [
          { path: 's-mayor/cedula-a.jpg', signedUrl: 'https://signed/cedula', error: null },
          { path: 's-mayor/sangre-b.pdf', signedUrl: 'https://signed/sangre', error: null },
        ],
        error: null,
      });
      mockedStorageFrom.mockReturnValue({ createSignedUrls });

      const res = await request(app)
        .get('/admin/solicitudes?estado=pendiente_revision')
        .set('Authorization', adminAuth());

      expect(res.status).toBe(200);
      expect(solicitudesChain.not).toHaveBeenCalledWith('cedula', 'is', null);
      expect(solicitudesChain.eq).toHaveBeenCalledWith('estado', 'pendiente_revision');
      expect(mockedStorageFrom).toHaveBeenCalledWith('solicitudes-documentos');
      // URL firmada de 5 minutos, nunca una URL pública.
      expect(createSignedUrls).toHaveBeenCalledWith(
        ['s-mayor/cedula-a.jpg', 's-mayor/sangre-b.pdf'],
        300,
      );

      const [mayor, joven] = res.body as {
        documentos: {
          tipoDocumento: string;
          estado: string;
          url: string | null;
          motivoRechazo: string | null;
        }[];
      }[];
      const byTipo = (s: typeof mayor) =>
        Object.fromEntries(s.documentos.map((d) => [d.tipoDocumento, d]));

      expect(mayor.documentos.map((d) => d.tipoDocumento)).toEqual([
        'cedula',
        'papeleta_votacion',
        'tipo_sangre',
        'titulo_bachiller',
      ]);
      expect(byTipo(mayor).cedula).toMatchObject({
        estado: 'recibido',
        url: 'https://signed/cedula',
      });
      expect(byTipo(mayor).tipo_sangre).toMatchObject({
        estado: 'rechazado',
        url: 'https://signed/sangre',
        motivoRechazo: 'Ilegible',
      });
      expect(byTipo(mayor).papeleta_votacion).toMatchObject({ estado: 'no_aplica', url: null });
      expect(byTipo(mayor).titulo_bachiller).toMatchObject({ estado: 'faltante' });

      // Menor de 65: la papeleta sí se espera.
      expect(byTipo(joven).papeleta_votacion.estado).toBe('faltante');

      // Ambas comparten cédula: cada una ve a la OTRA como relacionada,
      // nunca a sí misma.
      const withRelated = res.body as { id: string; solicitudesRelacionadas: unknown[] }[];
      expect(withRelated[0].solicitudesRelacionadas).toEqual([
        {
          id: 's-joven',
          correo: 'ana@example.com',
          estado: 'pendiente_revision',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
      expect(withRelated[1].solicitudesRelacionadas).toEqual([
        {
          id: 's-mayor',
          correo: 'ana@example.com',
          estado: 'pendiente_revision',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
    });

    it('si un mayor de 65 sí subió la papeleta, se muestra su estado real (no "no_aplica")', async () => {
      mockedFrom
        .mockReturnValueOnce(
          createChain({ data: [buildSolicitud({ fecha_nacimiento: '1950-01-01' })], error: null }),
        )
        .mockReturnValueOnce(
          createChain({
            data: [
              {
                id: 'd1',
                solicitud_id: solicitudId,
                tipo_documento: 'papeleta_votacion',
                storage_path: 'p.jpg',
                estado: 'aprobado',
                motivo_rechazo: null,
                uploaded_at: '2026-01-02T00:00:00Z',
                reviewed_at: null,
              },
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(createChain({ data: [], error: null })); // sin solicitudes relacionadas
      mockedStorageFrom.mockReturnValue({
        createSignedUrls: jest.fn().mockResolvedValue({
          data: [{ path: 'p.jpg', signedUrl: 'https://signed/p', error: null }],
          error: null,
        }),
      });

      const res = await request(app).get('/admin/solicitudes').set('Authorization', adminAuth());

      const papeleta = (
        res.body as { documentos: { tipoDocumento: string; estado: string }[] }[]
      )[0].documentos.find((d) => d.tipoDocumento === 'papeleta_votacion');
      expect(papeleta?.estado).toBe('aprobado');
    });
  });

  describe('PATCH /admin/solicitudes/:id/documentos/:docId', () => {
    const url = `/admin/solicitudes/${solicitudId}/documentos/${docId}`;

    it('responde 400 con un estado inválido', async () => {
      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'recibido' });
      expect(res.status).toBe(400);
    });

    it('rechaza un documento con motivo', async () => {
      const updateChain = createChain({ data: { id: docId }, error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(updateChain);

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'rechazado', motivoRechazo: 'Foto borrosa' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: docId, estado: 'rechazado' });
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ estado: 'rechazado', motivo_rechazo: 'Foto borrosa' }),
      );
      // Solo puede tocar documentos de ESTA solicitud.
      expect(updateChain.eq).toHaveBeenCalledWith('solicitud_id', solicitudId);
    });

    it('aprobar limpia el motivo de rechazo', async () => {
      const updateChain = createChain({ data: { id: docId }, error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(updateChain);

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'aprobado', motivoRechazo: 'ignorado' });

      expect(res.status).toBe(200);
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ estado: 'aprobado', motivo_rechazo: null }),
      );
    });

    it('responde 404 si el documento no pertenece a la solicitud', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'aprobado' });

      expect(res.status).toBe(404);
    });

    it('responde 409 si la solicitud ya fue resuelta', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: buildSolicitud({ estado: 'aprobada' }), error: null }),
      );

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'aprobado' });

      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /admin/solicitudes/:id (decisión final)', () => {
    const url = `/admin/solicitudes/${solicitudId}`;

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
        .send({ estado: 'rechazada' });

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
        .mockReturnValueOnce(updateChain);

      const res = await request(app)
        .patch(url)
        .set('Authorization', adminAuth())
        .send({ estado: 'rechazada', motivoRechazo: 'Documentos ilegibles' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: solicitudId,
        estado: 'rechazada',
        studentId: null,
        correoEnviado: null,
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

    describe('aprobación', () => {
      function buildCohortRow(overrides: Partial<Record<string, unknown>> = {}) {
        return {
          id: cohortId,
          precio: '150.00',
          cupo_maximo: 20,
          fecha_inicio_matricula: '2026-01-01',
          fecha_fin_matricula: '2026-12-31',
          fecha_inicio_curso: '2026-02-01',
          created_at: '2025-12-01T00:00:00Z',
          ...overrides,
        };
      }

      // Camino feliz: hay una cohorte del curso con matrícula abierta y
      // cupo, así que la asignación automática la elige (6 llamadas a
      // `.from`: getOrThrow, users insert, cohorts select, enrollments
      // (ocupación), enrollments insert, solicitud update).
      function mockApproveHappyPath() {
        mockedCreateUser.mockResolvedValue({ data: { user: { id: newStudentId } }, error: null });
        const usersInsertChain = createChain({ data: null, error: null });
        const cohortsSelectChain = createChain({ data: [buildCohortRow()], error: null });
        const enrollmentsOcupadosChain = createChain({ data: [], error: null });
        const enrollmentInsertChain = createChain({ data: null, error: null });
        const updateChain = createChain({
          data: buildSolicitud({ estado: 'aprobada' }),
          error: null,
        });
        mockedFrom
          .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null })) // getOrThrow
          .mockReturnValueOnce(usersInsertChain)
          .mockReturnValueOnce(cohortsSelectChain) // CohortAssignmentService: cohorts
          .mockReturnValueOnce(enrollmentsOcupadosChain) // CohortAssignmentService: ocupación
          .mockReturnValueOnce(enrollmentInsertChain) // insert enrollments
          .mockReturnValueOnce(updateChain); // solicitud -> aprobada
        return { usersInsertChain, cohortsSelectChain, enrollmentInsertChain, updateChain };
      }

      it('crea la cuenta con clave temporal, la fila en users (verificado + debe_cambiar_password) y guarda student_id', async () => {
        const { usersInsertChain, updateChain } = mockApproveHappyPath();

        const res = await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          id: solicitudId,
          estado: 'aprobada',
          studentId: newStudentId,
          correoEnviado: true,
        });
        expect(mockedCreateUser).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'ana@example.com',
            email_confirm: true,
            app_metadata: { role: 'estudiante' },
          }),
        );
        expect(usersInsertChain.insert).toHaveBeenCalledWith({
          id: newStudentId,
          cedula: '1710034065',
          nombre_completo: 'Ana Torres',
          telefono: '0991234567',
          rol: 'estudiante',
          status: 'verificado',
          debe_cambiar_password: true,
        });
        expect(updateChain.update).toHaveBeenCalledWith(
          expect.objectContaining({
            estado: 'aprobada',
            student_id: newStudentId,
            reviewed_by: adminId,
          }),
        );
        // Guard contra doble aprobación concurrente.
        expect(updateChain.eq).toHaveBeenCalledWith('estado', 'pendiente_revision');
      });

      it('envía por correo la contraseña temporal que se usó al crear la cuenta', async () => {
        mockApproveHappyPath();

        await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        const createdPassword = (mockedCreateUser.mock.calls[0][0] as { password: string })
          .password;
        expect(mockedSendMail).toHaveBeenCalledTimes(1);
        const mail = mockedSendMail.mock.calls[0][0] as { to: string; text: string };
        expect(mail.to).toBe('ana@example.com');
        expect(mail.text).toContain(createdPassword);
      });

      it('aprueba con total discreción: no exige documentos aprobados', async () => {
        mockApproveHappyPath();

        const res = await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        // getOrThrow, users insert, cohorts select, enrollments (ocupación),
        // enrollment insert, solicitud update: ninguna consulta a
        // solicitud_documentos.
        expect(res.status).toBe(200);
        expect(mockedFrom).toHaveBeenCalledTimes(6);
        expect((mockedFrom.mock.calls as string[][]).map((c) => c[0])).not.toContain(
          'solicitud_documentos',
        );
      });

      it('asigna automáticamente la cohorte del curso al que aplicó y crea el enrollment activo', async () => {
        const { cohortsSelectChain, enrollmentInsertChain } = mockApproveHappyPath();

        const res = await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        expect(res.status).toBe(200);
        expect(cohortsSelectChain.eq).toHaveBeenCalledWith('course_id', courseId);
        expect(enrollmentInsertChain.insert).toHaveBeenCalledWith({
          student_id: newStudentId,
          cohort_id: cohortId,
          status: 'activo',
          monto_total: 150,
        });
      });

      it('si ninguna cohorte del curso tiene matrícula abierta, crea el enrollment pendiente_cohorte', async () => {
        mockedCreateUser.mockResolvedValue({ data: { user: { id: newStudentId } }, error: null });
        const usersInsertChain = createChain({ data: null, error: null });
        const enrollmentInsertChain = createChain({ data: null, error: null });
        const updateChain = createChain({
          data: buildSolicitud({ estado: 'aprobada' }),
          error: null,
        });
        mockedFrom
          .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null })) // getOrThrow
          .mockReturnValueOnce(usersInsertChain)
          .mockReturnValueOnce(createChain({ data: [], error: null })) // cohorts: ninguna del curso
          .mockReturnValueOnce(enrollmentInsertChain)
          .mockReturnValueOnce(updateChain);

        const res = await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        expect(res.status).toBe(200);
        expect(enrollmentInsertChain.insert).toHaveBeenCalledWith({
          student_id: newStudentId,
          cohort_id: null,
          course_id: courseId,
          status: 'pendiente_cohorte',
          monto_total: null,
        });
      });

      it('si el correo falla, la cuenta igual queda creada (no se revierte) y el error se registra', async () => {
        mockApproveHappyPath();
        mockedSendMail.mockRejectedValueOnce(new Error('smtp caído'));

        const res = await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          estado: 'aprobada',
          studentId: newStudentId,
          correoEnviado: false,
        });
        expect(mockedDeleteUser).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
      });

      it('responde 409 sin crear nada si la solicitud no tiene los datos completos', async () => {
        mockedFrom.mockReturnValueOnce(
          createChain({
            data: buildSolicitud({ cedula: null, nombre_completo: null }),
            error: null,
          }),
        );

        const res = await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        expect(res.status).toBe(409);
        expect(mockedCreateUser).not.toHaveBeenCalled();
      });

      it('responde 409 si ya existe un usuario de Auth con ese correo, sin tocar la base', async () => {
        mockedCreateUser.mockResolvedValue({
          data: { user: null },
          error: { code: 'email_exists' },
        });
        mockedFrom.mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }));

        const res = await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        expect(res.status).toBe(409);
        expect(mockedFrom).toHaveBeenCalledTimes(1);
      });

      it('si la cédula ya existe en users, responde 409 y borra la cuenta de Auth recién creada', async () => {
        mockedCreateUser.mockResolvedValue({ data: { user: { id: newStudentId } }, error: null });
        mockedFrom
          .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null }))
          .mockReturnValueOnce(
            createChain({ data: null, error: { code: '23505', message: 'duplicate' } }),
          )
          // Rollback: intenta borrar un enrollment huérfano (no llegó a
          // crearse ninguno en este punto, pero el borrado es incondicional
          // y no-op si no hay filas).
          .mockReturnValueOnce(createChain({ data: null, error: null }));

        const res = await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        expect(res.status).toBe(409);
        expect(mockedDeleteUser).toHaveBeenCalledWith(newStudentId);
        expect(mockedSendMail).not.toHaveBeenCalled();
      });

      it('si otra aprobación ganó la carrera (el UPDATE no matchea), borra el enrollment y la cuenta creados, responde 409', async () => {
        mockedCreateUser.mockResolvedValue({ data: { user: { id: newStudentId } }, error: null });
        mockedFrom
          .mockReturnValueOnce(createChain({ data: buildSolicitud(), error: null })) // getOrThrow
          .mockReturnValueOnce(createChain({ data: null, error: null })) // users insert ok
          .mockReturnValueOnce(createChain({ data: [buildCohortRow()], error: null })) // cohorts
          .mockReturnValueOnce(createChain({ data: [], error: null })) // ocupación
          .mockReturnValueOnce(createChain({ data: null, error: null })) // enrollment insert ok
          .mockReturnValueOnce(createChain({ data: null, error: null })) // update: 0 filas
          .mockReturnValueOnce(createChain({ data: null, error: null })); // rollback: borra enrollment

        const res = await request(app)
          .patch(url)
          .set('Authorization', adminAuth())
          .send({ estado: 'aprobada' });

        expect(res.status).toBe(409);
        expect(mockedDeleteUser).toHaveBeenCalledWith(newStudentId);
        expect(mockedSendMail).not.toHaveBeenCalled();
      });
    });
  });
});
