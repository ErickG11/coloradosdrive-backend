import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import type { CreateEnrollmentInput } from '../../src/models/enrollment.model';
import type {
  AssignCohortForCourseResult,
  CohortAssignmentService,
} from '../../src/services/cohortAssignment.service';
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

function buildSupabaseMock(fromResults: ChainResult[]) {
  const createUser = jest.fn();
  const deleteUser = jest.fn().mockResolvedValue({ data: {}, error: null });
  const from = createSupabaseFromMock(fromResults);

  const raw = {
    from,
    auth: { admin: { createUser, deleteUser } },
  };

  return {
    supabase: raw as unknown as SupabaseClient<Database>,
    createUser,
    deleteUser,
    from,
  };
}

function buildEmailService() {
  const sendWelcomeEmail = jest.fn().mockResolvedValue(undefined);
  return {
    emailService: { sendWelcomeEmail } as unknown as EmailService,
    sendWelcomeEmail,
  };
}

function buildCohortAssignmentService(results: AssignCohortForCourseResult[] = []) {
  const assignCohortForCourse = jest.fn();
  results.forEach((result) => assignCohortForCourse.mockResolvedValueOnce(result));
  return {
    cohortAssignmentService: { assignCohortForCourse } as unknown as CohortAssignmentService,
    assignCohortForCourse,
  };
}

describe('EnrollmentService.enrollStudent', () => {
  it('rechaza con 404 si la cohorte no existe', async () => {
    const { supabase } = buildSupabaseMock([{ data: null, error: null }]);
    const { emailService, sendWelcomeEmail } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    await expect(service.enrollStudent(validInput)).rejects.toMatchObject({ statusCode: 404 });
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si la cédula ya está registrada, sin crear el usuario en Auth', async () => {
    const { supabase, createUser } = buildSupabaseMock([
      { data: cohortRow, error: null }, // getCohortOrThrow
      { data: { id: 'existing-user' }, error: null }, // assertCedulaAvailable: ya existe
    ]);
    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

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
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    await expect(service.enrollStudent(validInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'El estudiante ya está activo en otra cohorte',
    });
    expect(deleteUser).toHaveBeenCalledWith(studentId);
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('rechaza con 409 y compensa si la cohorte ya alcanzó su cupo máximo (enforce_cohort_cupo)', async () => {
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
      {
        data: null,
        error: { code: 'CD001', message: 'La cohorte ya alcanzó su cupo máximo (20)' },
      }, // createEnrollmentRow: trigger enforce_cohort_cupo
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService, sendWelcomeEmail } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    await expect(service.enrollStudent(validInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'La cohorte ya alcanzó su cupo máximo',
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
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

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

  it('acepta y persiste los datos ampliados del estudiante como opcionales', async () => {
    const studentId = 'new-student-id';
    const inputConDatosAmpliados: CreateEnrollmentInput = {
      ...validInput,
      fechaNacimiento: '2000-05-15',
      tipoSangre: 'O+',
      genero: 'Femenino',
      ciudadania: 'Ecuatoriana',
      direccion: 'Av. Siempre Viva 123',
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
    const userRow = {
      id: studentId,
      cedula: inputConDatosAmpliados.cedula,
      nombre_completo: inputConDatosAmpliados.nombreCompleto,
      telefono: inputConDatosAmpliados.telefono,
      rol: 'estudiante',
      fecha_nacimiento: inputConDatosAmpliados.fechaNacimiento,
      tipo_sangre: inputConDatosAmpliados.tipoSangre,
      genero: inputConDatosAmpliados.genero,
      ciudadania: inputConDatosAmpliados.ciudadania,
      direccion: inputConDatosAmpliados.direccion,
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    const { supabase, createUser, from } = buildSupabaseMock([
      { data: cohortRow, error: null },
      { data: null, error: null },
      { data: userRow, error: null },
      { data: enrollmentRow, error: null },
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    const result = await service.enrollStudent(inputConDatosAmpliados);

    // Tercera llamada a .from(): createUserRow (0=cohorts, 1=assertCedulaAvailable, 2=users insert).
    const usersInsertCall = from.mock.results[2].value.insert as jest.Mock;
    expect(usersInsertCall).toHaveBeenCalledWith(
      expect.objectContaining({
        fecha_nacimiento: '2000-05-15',
        tipo_sangre: 'O+',
        genero: 'Femenino',
        ciudadania: 'Ecuatoriana',
        direccion: 'Av. Siempre Viva 123',
      }),
    );

    expect(result.student).toMatchObject({
      fechaNacimiento: '2000-05-15',
      tipoSangre: 'O+',
      genero: 'Femenino',
      ciudadania: 'Ecuatoriana',
      direccion: 'Av. Siempre Viva 123',
    });
  });

  it('sin datos ampliados, los inserta como null', async () => {
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
      fecha_nacimiento: null,
      tipo_sangre: null,
      genero: null,
      ciudadania: null,
      direccion: null,
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    const { supabase, createUser, from } = buildSupabaseMock([
      { data: cohortRow, error: null },
      { data: null, error: null },
      { data: userRow, error: null },
      { data: enrollmentRow, error: null },
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    const result = await service.enrollStudent(validInput);

    const usersInsertCall = from.mock.results[2].value.insert as jest.Mock;
    expect(usersInsertCall).toHaveBeenCalledWith(
      expect.objectContaining({
        fecha_nacimiento: null,
        tipo_sangre: null,
        genero: null,
        ciudadania: null,
        direccion: null,
      }),
    );
    expect(result.student).toMatchObject({
      fechaNacimiento: null,
      tipoSangre: null,
      genero: null,
      ciudadania: null,
      direccion: null,
    });
  });
});

describe('EnrollmentService.enrollStudent (pago inicial: descuento y monto abonado)', () => {
  const studentId = 'new-student-id';
  const userRow = {
    id: studentId,
    cedula: validInput.cedula,
    nombre_completo: validInput.nombreCompleto,
    telefono: validInput.telefono,
    rol: 'estudiante',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  };

  it('sin descuento ni montoAbonado, inserta ambos en 0 y monto_total = precio de la cohorte', async () => {
    const enrollmentRow = {
      id: 'enrollment-1',
      student_id: studentId,
      cohort_id: cohortRow.id,
      status: 'activo',
      monto_total: '150.00',
      descuento: '0',
      monto_abonado: '0',
      fecha_inscripcion: '2026-01-02T00:00:00Z',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const { supabase, createUser, from } = buildSupabaseMock([
      { data: cohortRow, error: null },
      { data: null, error: null },
      { data: userRow, error: null },
      { data: enrollmentRow, error: null },
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    const result = await service.enrollStudent(validInput);

    const enrollmentInsertCall = from.mock.results[3].value.insert as jest.Mock;
    expect(enrollmentInsertCall).toHaveBeenCalledWith(
      expect.objectContaining({ monto_total: 150, descuento: 0, monto_abonado: 0 }),
    );
    expect(result.enrollment).toMatchObject({ montoTotal: 150, descuento: 0, montoAbonado: 0 });
  });

  it('resta el descuento del precio de la cohorte y persiste el monto abonado ("abona" parcial)', async () => {
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
    const { supabase, createUser, from } = buildSupabaseMock([
      { data: cohortRow, error: null },
      { data: null, error: null },
      { data: userRow, error: null },
      { data: enrollmentRow, error: null },
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    const result = await service.enrollStudent({ ...validInput, descuento: 50, montoAbonado: 30 });

    const enrollmentInsertCall = from.mock.results[3].value.insert as jest.Mock;
    expect(enrollmentInsertCall).toHaveBeenCalledWith(
      expect.objectContaining({ monto_total: 100, descuento: 50, monto_abonado: 30 }),
    );
    expect(result.enrollment).toMatchObject({ montoTotal: 100, descuento: 50, montoAbonado: 30 });
  });

  it('"paga todo": montoAbonado igual a monto_total (precio menos descuento) se acepta', async () => {
    const enrollmentRow = {
      id: 'enrollment-1',
      student_id: studentId,
      cohort_id: cohortRow.id,
      status: 'activo',
      monto_total: '150.00',
      descuento: '0',
      monto_abonado: '150.00',
      fecha_inscripcion: '2026-01-02T00:00:00Z',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const { supabase, createUser } = buildSupabaseMock([
      { data: cohortRow, error: null },
      { data: null, error: null },
      { data: userRow, error: null },
      { data: enrollmentRow, error: null },
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    const result = await service.enrollStudent({ ...validInput, montoAbonado: 150 });

    expect(result.enrollment).toMatchObject({ montoTotal: 150, montoAbonado: 150 });
  });

  it('rechaza con 400 si el descuento supera el precio de la cohorte, sin crear ningún usuario en Auth', async () => {
    const { supabase, createUser } = buildSupabaseMock([{ data: cohortRow, error: null }]);
    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    await expect(
      service.enrollStudent({ ...validInput, descuento: 200 }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'El descuento no puede ser mayor al precio de la cohorte',
    });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si el monto abonado supera el monto total, sin crear ningún usuario en Auth', async () => {
    const { supabase, createUser } = buildSupabaseMock([{ data: cohortRow, error: null }]);
    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService();
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    await expect(
      service.enrollStudent({ ...validInput, montoAbonado: 151 }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'El monto abonado no puede ser mayor al monto total',
    });
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe('EnrollmentService.enrollStudent (sin cohortId: asignación automática, Fase 10)', () => {
  const autoAssignInput: CreateEnrollmentInput = {
    cedula: '1234567890',
    nombreCompleto: 'Ana Torres',
    correo: 'ana@example.com',
    telefono: '0999999999',
    courseId: 'course-uuid-1',
  };

  const studentId = 'new-student-id';
  const userRow = {
    id: studentId,
    cedula: autoAssignInput.cedula,
    nombre_completo: autoAssignInput.nombreCompleto,
    telefono: autoAssignInput.telefono,
    rol: 'estudiante',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  };

  it('asigna la cohorte sugerida por CohortAssignmentService y crea la matrícula activa', async () => {
    const enrollmentRow = {
      id: 'enrollment-1',
      student_id: studentId,
      cohort_id: 'cohort-uuid-1',
      status: 'activo',
      monto_total: '150.00',
      fecha_inscripcion: '2026-01-02T00:00:00Z',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const { supabase, createUser, deleteUser } = buildSupabaseMock([
      { data: null, error: null }, // assertCedulaAvailable: libre (no hay getCohortOrThrow)
      { data: userRow, error: null }, // createUserRow
      { data: enrollmentRow, error: null }, // insertEnrollmentRow
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService } = buildEmailService();
    const { cohortAssignmentService, assignCohortForCourse } = buildCohortAssignmentService([
      { cohortId: 'cohort-uuid-1', warning: null, precio: 150, cohortNombre: 'Cohorte Marzo' },
    ]);
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    const result = await service.enrollStudent(autoAssignInput);

    expect(assignCohortForCourse).toHaveBeenCalledWith('course-uuid-1', undefined, []);
    expect(result.enrollment).toMatchObject({ id: 'enrollment-1', cohortId: 'cohort-uuid-1' });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('aplica descuento y monto abonado también cuando la cohorte se asigna automáticamente', async () => {
    const enrollmentRow = {
      id: 'enrollment-1',
      student_id: studentId,
      cohort_id: 'cohort-uuid-1',
      status: 'activo',
      monto_total: '100.00',
      descuento: '50',
      monto_abonado: '100.00',
      fecha_inscripcion: '2026-01-02T00:00:00Z',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const { supabase, createUser, from } = buildSupabaseMock([
      { data: null, error: null }, // assertCedulaAvailable
      { data: userRow, error: null }, // createUserRow
      { data: enrollmentRow, error: null }, // insertEnrollmentRow
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });

    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService([
      { cohortId: 'cohort-uuid-1', warning: null, precio: 150, cohortNombre: 'Cohorte Marzo' },
    ]);
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    const result = await service.enrollStudent({
      ...autoAssignInput,
      descuento: 50,
      montoAbonado: 100,
    });

    const enrollmentInsertCall = from.mock.results[2].value.insert as jest.Mock;
    expect(enrollmentInsertCall).toHaveBeenCalledWith(
      expect.objectContaining({ monto_total: 100, descuento: 50, monto_abonado: 100 }),
    );
    expect(result.enrollment).toMatchObject({ montoTotal: 100, descuento: 50, montoAbonado: 100 });
  });

  it('sin ninguna cohorte elegible, crea la matrícula como pendiente_cohorte', async () => {
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
    const { supabase, createUser } = buildSupabaseMock([
      { data: null, error: null }, // assertCedulaAvailable
      { data: userRow, error: null }, // createUserRow
      { data: enrollmentRow, error: null }, // insertEnrollmentRow (pendiente_cohorte)
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });
    const { emailService } = buildEmailService();
    const { cohortAssignmentService } = buildCohortAssignmentService([
      { cohortId: null, warning: null, precio: null, cohortNombre: null },
    ]);
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    const result = await service.enrollStudent(autoAssignInput);

    expect(result.enrollment).toMatchObject({
      id: 'enrollment-1',
      cohortId: null,
      status: 'pendiente_cohorte',
      montoTotal: null,
    });
  });

  it('reintenta excluyendo la cohorte si se llenó por condición de carrera (enforce_cohort_cupo)', async () => {
    const enrollmentRow = {
      id: 'enrollment-1',
      student_id: studentId,
      cohort_id: 'con-cupo',
      status: 'activo',
      monto_total: '150.00',
      fecha_inscripcion: '2026-01-02T00:00:00Z',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const { supabase, createUser } = buildSupabaseMock([
      { data: null, error: null }, // assertCedulaAvailable
      { data: userRow, error: null }, // createUserRow
      {
        data: null,
        error: { code: 'CD001', message: 'La cohorte ya alcanzó su cupo máximo (20)' },
      }, // insertEnrollmentRow: primer intento, cae por condición de carrera
      { data: enrollmentRow, error: null }, // insertEnrollmentRow: reintento exitoso
    ]);
    createUser.mockResolvedValue({ data: { user: { id: studentId } }, error: null });
    const { emailService } = buildEmailService();
    const { cohortAssignmentService, assignCohortForCourse } = buildCohortAssignmentService([
      { cohortId: 'llena', warning: null, precio: 150, cohortNombre: 'Cohorte Marzo' },
      { cohortId: 'con-cupo', warning: null, precio: 150, cohortNombre: 'Cohorte Abril' },
    ]);
    const service = new EnrollmentService(supabase, emailService, cohortAssignmentService);

    const result = await service.enrollStudent(autoAssignInput);

    // El segundo elemento del array excluidas se muta in-place entre
    // llamadas (mismo patrón que SolicitudService.crearEnrollmentConAsignacion),
    // así que ambas entradas de mock.calls apuntan a la misma referencia:
    // solo la snapshot tomada en la primera llamada (antes de la segunda)
    // refleja el estado real en ese momento.
    expect(assignCohortForCourse).toHaveBeenCalledTimes(2);
    expect(assignCohortForCourse.mock.calls[0][0]).toBe('course-uuid-1');
    expect(assignCohortForCourse.mock.calls[1][2]).toEqual(['llena']);
    expect(result.enrollment).toMatchObject({ id: 'enrollment-1', cohortId: 'con-cupo' });
  });
});
