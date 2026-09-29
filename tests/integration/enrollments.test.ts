import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
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

const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedCreateUser = supabaseAdmin.auth.admin.createUser as jest.Mock;
const mockedDeleteUser = supabaseAdmin.auth.admin.deleteUser as jest.Mock;
const mockedSendMail = mailer.sendMail as jest.Mock;
const mockedVerifySupabaseJwt = verifySupabaseJwt as unknown as jest.Mock;

const validEnrollmentBody = {
  cedula: '1234567890',
  nombreCompleto: 'Ana Torres',
  correo: 'ana@example.com',
  telefono: '0999999999',
  cohortId: '11111111-1111-4111-8111-111111111111',
};

const cohortRow = {
  id: validEnrollmentBody.cohortId,
  course_id: '22222222-2222-4222-8222-222222222222',
  nombre: 'Cohorte Marzo',
  precio: '150.00',
  cupo_maximo: 20,
  fecha_inicio_matricula: '2026-02-01',
  fecha_fin_matricula: '2026-02-25',
  fecha_inicio_curso: '2026-03-01',
  fecha_fin_curso: '2026-06-01',
  tipo_modalidad: null,
  horarios_capacitacion_teoria: null,
  numero_vehiculos: null,
  numero_aulas: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('POST /enrollments', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedCreateUser.mockReset();
    mockedDeleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
    mockedSendMail.mockReset().mockResolvedValue({});
    mockedVerifySupabaseJwt.mockReset();
  });

  describe('protección por autenticación y rol (RNF-03)', () => {
    it('sin token responde 401', async () => {
      const res = await request(app).post('/enrollments').send(validEnrollmentBody);
      expect(res.status).toBe(401);
    });

    it('con rol no-admin responde 403', async () => {
      const res = await request(app)
        .post('/enrollments')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`)
        .send(validEnrollmentBody);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });
  });

  it('responde 400 si la cédula no tiene 10 dígitos', async () => {
    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ ...validEnrollmentBody, cedula: '123' });

    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('responde 400 si no se manda ni cohortId ni courseId', async () => {
    const { cohortId: _cohortId, ...bodySinCohorte } = validEnrollmentBody;

    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send(bodySinCohorte);

    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('responde 400 si fechaNacimiento no tiene formato YYYY-MM-DD', async () => {
    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ ...validEnrollmentBody, fechaNacimiento: '15-05-2000' });

    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('responde 409 si la cédula ya está registrada', async () => {
    mockedFrom
      .mockReturnValueOnce(createChain({ data: cohortRow, error: null })) // getCohortOrThrow
      .mockReturnValueOnce(createChain({ data: { id: 'existing-user' }, error: null })); // assertCedulaAvailable

    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send(validEnrollmentBody);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('La cédula ya está registrada');
    expect(mockedCreateUser).not.toHaveBeenCalled();
  });

  it('responde 409 (no 500) si el correo ya existe en Supabase Auth', async () => {
    mockedFrom
      .mockReturnValueOnce(createChain({ data: cohortRow, error: null })) // getCohortOrThrow
      .mockReturnValueOnce(createChain({ data: null, error: null })); // assertCedulaAvailable: libre
    mockedCreateUser.mockResolvedValue({
      data: { user: null },
      error: {
        name: 'AuthApiError',
        message: 'A user with this email address has already been registered',
        code: 'email_exists',
        status: 422,
      },
    });

    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send(validEnrollmentBody);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Ya existe un usuario registrado con este correo electrónico');
    // No se creó ningún usuario que haya que compensar/borrar.
    expect(mockedDeleteUser).not.toHaveBeenCalled();
  });

  it('matricula al estudiante, envía el correo, y responde 201', async () => {
    const studentId = 'new-student-id';
    const userRow = {
      id: studentId,
      cedula: validEnrollmentBody.cedula,
      nombre_completo: validEnrollmentBody.nombreCompleto,
      telefono: validEnrollmentBody.telefono,
      rol: 'estudiante',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const enrollmentRow = {
      id: 'enrollment-1',
      student_id: studentId,
      cohort_id: cohortRow.id,
      status: 'activo',
      monto_total: cohortRow.precio,
      fecha_inscripcion: '2026-01-02T00:00:00Z',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    mockedFrom
      .mockReturnValueOnce(createChain({ data: cohortRow, error: null })) // getCohortOrThrow
      .mockReturnValueOnce(createChain({ data: null, error: null })) // assertCedulaAvailable
      .mockReturnValueOnce(createChain({ data: userRow, error: null })) // createUserRow
      .mockReturnValueOnce(createChain({ data: enrollmentRow, error: null })); // createEnrollmentRow
    mockedCreateUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send(validEnrollmentBody);

    expect(res.status).toBe(201);
    expect(res.body.student).toMatchObject({ id: studentId, cedula: validEnrollmentBody.cedula });
    expect(res.body.enrollment).toMatchObject({ id: 'enrollment-1', cohortId: cohortRow.id });
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    expect(mockedDeleteUser).not.toHaveBeenCalled();
  });

  it('acepta y persiste los datos ampliados del estudiante (fechaNacimiento, tipoSangre, genero, ciudadania, direccion)', async () => {
    const studentId = 'new-student-id';
    const bodyConDatosAmpliados = {
      ...validEnrollmentBody,
      fechaNacimiento: '2000-05-15',
      tipoSangre: 'O+',
      genero: 'Femenino',
      ciudadania: 'Ecuatoriana',
      direccion: 'Av. Siempre Viva 123',
    };
    const userRow = {
      id: studentId,
      cedula: bodyConDatosAmpliados.cedula,
      nombre_completo: bodyConDatosAmpliados.nombreCompleto,
      telefono: bodyConDatosAmpliados.telefono,
      rol: 'estudiante',
      fecha_nacimiento: bodyConDatosAmpliados.fechaNacimiento,
      tipo_sangre: bodyConDatosAmpliados.tipoSangre,
      genero: bodyConDatosAmpliados.genero,
      ciudadania: bodyConDatosAmpliados.ciudadania,
      direccion: bodyConDatosAmpliados.direccion,
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const enrollmentRow = {
      id: 'enrollment-1',
      student_id: studentId,
      cohort_id: cohortRow.id,
      status: 'activo',
      monto_total: cohortRow.precio,
      fecha_inscripcion: '2026-01-02T00:00:00Z',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    let usersInsertBody: unknown;
    mockedFrom
      .mockReturnValueOnce(createChain({ data: cohortRow, error: null })) // getCohortOrThrow
      .mockReturnValueOnce(createChain({ data: null, error: null })) // assertCedulaAvailable
      .mockImplementationOnce(() => {
        const chain = createChain({ data: userRow, error: null });
        chain.insert = jest.fn((body: unknown) => {
          usersInsertBody = body;
          return chain;
        });
        return chain;
      }) // createUserRow
      .mockReturnValueOnce(createChain({ data: enrollmentRow, error: null })); // createEnrollmentRow
    mockedCreateUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send(bodyConDatosAmpliados);

    expect(res.status).toBe(201);
    expect(usersInsertBody).toMatchObject({
      fecha_nacimiento: '2000-05-15',
      tipo_sangre: 'O+',
      genero: 'Femenino',
      ciudadania: 'Ecuatoriana',
      direccion: 'Av. Siempre Viva 123',
    });
    expect(res.body.student).toMatchObject({
      fechaNacimiento: '2000-05-15',
      tipoSangre: 'O+',
      genero: 'Femenino',
      ciudadania: 'Ecuatoriana',
      direccion: 'Av. Siempre Viva 123',
    });
  });

  it('responde 400 si descuento o montoAbonado son negativos', async () => {
    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ ...validEnrollmentBody, descuento: -10 });

    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('responde 400 (no 500) si el descuento supera el precio de la cohorte', async () => {
    mockedFrom.mockReturnValueOnce(createChain({ data: cohortRow, error: null })); // getCohortOrThrow

    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ ...validEnrollmentBody, descuento: 200 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('El descuento no puede ser mayor al precio de la cohorte');
    expect(mockedCreateUser).not.toHaveBeenCalled();
  });

  it('aplica el descuento y persiste el monto abonado en la respuesta de creación de matrícula', async () => {
    const studentId = 'new-student-id';
    const userRow = {
      id: studentId,
      cedula: validEnrollmentBody.cedula,
      nombre_completo: validEnrollmentBody.nombreCompleto,
      telefono: validEnrollmentBody.telefono,
      rol: 'estudiante',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const enrollmentRow = {
      id: 'enrollment-1',
      student_id: studentId,
      cohort_id: cohortRow.id,
      status: 'activo',
      monto_total: '100.00',
      descuento: '50',
      monto_abonado: '30',
      fecha_inscripcion: '2026-01-02T00:00:00Z',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    mockedFrom
      .mockReturnValueOnce(createChain({ data: cohortRow, error: null })) // getCohortOrThrow
      .mockReturnValueOnce(createChain({ data: null, error: null })) // assertCedulaAvailable
      .mockReturnValueOnce(createChain({ data: userRow, error: null })) // createUserRow
      .mockReturnValueOnce(createChain({ data: enrollmentRow, error: null })); // createEnrollmentRow
    mockedCreateUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ ...validEnrollmentBody, descuento: 50, montoAbonado: 30 });

    expect(res.status).toBe(201);
    expect(res.body.enrollment).toMatchObject({ montoTotal: 100, descuento: 50, montoAbonado: 30 });
  });

  describe('sin cohortId: asignación automática vía CohortAssignmentService (Fase 10)', () => {
    const studentId = 'new-student-id';
    const bodySinCohorte = {
      cedula: '1234567890',
      nombreCompleto: 'Ana Torres',
      correo: 'ana@example.com',
      telefono: '0999999999',
      courseId: cohortRow.course_id,
    };
    const userRow = {
      id: studentId,
      cedula: bodySinCohorte.cedula,
      nombre_completo: bodySinCohorte.nombreCompleto,
      telefono: bodySinCohorte.telefono,
      rol: 'estudiante',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    beforeEach(() => {
      mockedCreateUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });
    });

    it('asigna automáticamente la cohorte elegible y responde 201', async () => {
      const enrollmentRow = {
        id: 'enrollment-1',
        student_id: studentId,
        cohort_id: cohortRow.id,
        status: 'activo',
        monto_total: cohortRow.precio,
        fecha_inscripcion: '2026-01-02T00:00:00Z',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      };

      mockedFrom
        .mockReturnValueOnce(createChain({ data: null, error: null })) // assertCedulaAvailable
        .mockReturnValueOnce(createChain({ data: userRow, error: null })) // createUserRow
        .mockReturnValueOnce(createChain({ data: [cohortRow], error: null })) // CohortAssignmentService: cohorts
        .mockReturnValueOnce(createChain({ data: [], error: null })) // CohortAssignmentService: ocupados
        .mockReturnValueOnce(createChain({ data: enrollmentRow, error: null })); // insertEnrollmentRow

      const res = await request(app)
        .post('/enrollments')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(bodySinCohorte);

      expect(res.status).toBe(201);
      expect(res.body.enrollment).toMatchObject({ id: 'enrollment-1', cohortId: cohortRow.id });
      expect(mockedSendMail).toHaveBeenCalledTimes(1);
    });

    it('sin ninguna cohorte con matrícula abierta, crea la matrícula pendiente_cohorte y responde 201', async () => {
      const enrollmentRow = {
        id: 'enrollment-1',
        student_id: studentId,
        cohort_id: null,
        status: 'pendiente_cohorte',
        monto_total: null,
        fecha_inscripcion: '2026-01-02T00:00:00Z',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      };

      mockedFrom
        .mockReturnValueOnce(createChain({ data: null, error: null })) // assertCedulaAvailable
        .mockReturnValueOnce(createChain({ data: userRow, error: null })) // createUserRow
        .mockReturnValueOnce(createChain({ data: [], error: null })) // CohortAssignmentService: sin cohortes
        .mockReturnValueOnce(createChain({ data: enrollmentRow, error: null })); // insertEnrollmentRow

      const res = await request(app)
        .post('/enrollments')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(bodySinCohorte);

      expect(res.status).toBe(201);
      expect(res.body.enrollment).toMatchObject({
        id: 'enrollment-1',
        cohortId: null,
        status: 'pendiente_cohorte',
        montoTotal: null,
      });
    });
  });
});
