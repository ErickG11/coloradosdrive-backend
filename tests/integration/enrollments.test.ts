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

import { createApp } from '../../src/app';
import { mailer } from '../../src/config/mailer';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { signToken } from '../helpers/tokens';

const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedCreateUser = supabaseAdmin.auth.admin.createUser as jest.Mock;
const mockedDeleteUser = supabaseAdmin.auth.admin.deleteUser as jest.Mock;
const mockedSendMail = mailer.sendMail as jest.Mock;

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
  fecha_inicio: '2026-03-01',
  fecha_fin: '2026-06-01',
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
  });

  describe('protección por autenticación y rol (RNF-03)', () => {
    it('sin token responde 401', async () => {
      const res = await request(app).post('/enrollments').send(validEnrollmentBody);
      expect(res.status).toBe(401);
    });

    it('con rol no-admin responde 403', async () => {
      const res = await request(app)
        .post('/enrollments')
        .set('Authorization', `Bearer ${signToken('instructor')}`)
        .send(validEnrollmentBody);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });
  });

  it('responde 400 si la cédula no tiene 10 dígitos', async () => {
    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${signToken('admin')}`)
      .send({ ...validEnrollmentBody, cedula: '123' });

    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('responde 409 si la cédula ya está registrada', async () => {
    mockedFrom
      .mockReturnValueOnce(createChain({ data: cohortRow, error: null })) // getCohortOrThrow
      .mockReturnValueOnce(createChain({ data: { id: 'existing-user' }, error: null })); // assertCedulaAvailable

    const res = await request(app)
      .post('/enrollments')
      .set('Authorization', `Bearer ${signToken('admin')}`)
      .send(validEnrollmentBody);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('La cédula ya está registrada');
    expect(mockedCreateUser).not.toHaveBeenCalled();
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
      .set('Authorization', `Bearer ${signToken('admin')}`)
      .send(validEnrollmentBody);

    expect(res.status).toBe(201);
    expect(res.body.student).toMatchObject({ id: studentId, cedula: validEnrollmentBody.cedula });
    expect(res.body.enrollment).toMatchObject({ id: 'enrollment-1', cohortId: cohortRow.id });
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    expect(mockedDeleteUser).not.toHaveBeenCalled();
  });
});
