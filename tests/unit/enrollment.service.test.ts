import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import type { CreateEnrollmentInput } from '../../src/models/enrollment.model';
import type { EmailService } from '../../src/services/email.service';
import { EnrollmentService } from '../../src/services/enrollment.service';
import { createSupabaseFromMock, type ChainResult } from '../helpers/supabaseMock';

const validInput: CreateEnrollmentInput = {
  cedula: '1234567890',
  nombreCompleto: 'Ana Torres',
  correo: 'ana@example.com',
  telefono: '0999999999',
  cohortId: 'cohort-uuid-1',
};

const cohortRow = {
  id: 'cohort-uuid-1',
  course_id: 'course-uuid-1',
  nombre: 'Cohorte Marzo',
  precio: '150.00',
  cupo_maximo: 20,
  fecha_inicio: '2026-03-01',
  fecha_fin: '2026-06-01',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function buildSupabaseMock(fromResults: ChainResult[]) {
  const createUser = jest.fn();
  const deleteUser = jest.fn().mockResolvedValue({ data: {}, error: null });

  const raw = {
    from: createSupabaseFromMock(fromResults),
    auth: { admin: { createUser, deleteUser } },
  };

  return {
    supabase: raw as unknown as SupabaseClient<Database>,
    createUser,
    deleteUser,
  };
}

function buildEmailService() {
  const sendWelcomeEmail = jest.fn().mockResolvedValue(undefined);
  return {
    emailService: { sendWelcomeEmail } as unknown as EmailService,
    sendWelcomeEmail,
  };
}

describe('EnrollmentService.enrollStudent', () => {
  it('rechaza con 404 si la cohorte no existe', async () => {
    const { supabase } = buildSupabaseMock([{ data: null, error: null }]);
    const { emailService, sendWelcomeEmail } = buildEmailService();
    const service = new EnrollmentService(supabase, emailService);

    await expect(service.enrollStudent(validInput)).rejects.toMatchObject({ statusCode: 404 });
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si la cédula ya está registrada, sin crear el usuario en Auth', async () => {
    const { supabase, createUser } = buildSupabaseMock([
      { data: cohortRow, error: null }, // getCohortOrThrow
      { data: { id: 'existing-user' }, error: null }, // assertCedulaAvailable: ya existe
    ]);
    const { emailService } = buildEmailService();
    const service = new EnrollmentService(supabase, emailService);

    await expect(service.enrollStudent(validInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'La cédula ya está registrada',
    });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rechaza con 409 y compensa (borra el usuario de Auth) si el estudiante ya está activo en otra cohorte', async () => {
    const studentId = 'new-student-id';
    const { supabase, createUser, deleteUser } = buildSupabaseMock([
      { data: cohortRow, error: null }, // getCohortOrThrow
      { data: null, error: null }, // assertCedulaAvailable: libre
      {
        data: {
          id: studentId,
          cedula: validInput.cedula,
          nombre_completo: validInput.nombreCompleto,
          telefono: validInput.telefono,
          rol: 'estudiante',
          created_at: '2026-01-02T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
        error: null,
      }, // createUserRow
      { data: null, error: { code: '23505', message: 'duplicate key' } }, // createEnrollmentRow: violación
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService, sendWelcomeEmail } = buildEmailService();
    const service = new EnrollmentService(supabase, emailService);

    await expect(service.enrollStudent(validInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'El estudiante ya está activo en otra cohorte',
    });
    expect(deleteUser).toHaveBeenCalledWith(studentId);
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('crea la cuenta, la matrícula, y envía el correo de bienvenida en el camino feliz', async () => {
    const studentId = 'new-student-id';
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
    const userRow = {
      id: studentId,
      cedula: validInput.cedula,
      nombre_completo: validInput.nombreCompleto,
      telefono: validInput.telefono,
      rol: 'estudiante',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    const { supabase, createUser, deleteUser } = buildSupabaseMock([
      { data: cohortRow, error: null },
      { data: null, error: null },
      { data: userRow, error: null },
      { data: enrollmentRow, error: null },
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService, sendWelcomeEmail } = buildEmailService();
    const service = new EnrollmentService(supabase, emailService);

    const result = await service.enrollStudent(validInput);

    expect(result.student).toMatchObject({ id: studentId, cedula: validInput.cedula });
    expect(result.enrollment).toMatchObject({ id: 'enrollment-1', cohortId: cohortRow.id });
    expect(sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: validInput.correo,
        nombreCompleto: validInput.nombreCompleto,
      }),
    );
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
