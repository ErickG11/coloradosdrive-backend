import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { StudentAdminService } from '../../src/services/studentAdmin.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';

const studentId = '22222222-2222-4222-8222-222222222222';
const actorId = '11111111-1111-4111-8111-111111111111';
const version = '2026-10-01T10:00:00.123456+00:00';
const user = {
  id: studentId,
  rol: 'estudiante',
  nombre_completo: 'Alumno',
  cedula: '1710034065',
  telefono: null,
  activo: true,
  status: 'activo',
  debe_cambiar_password: false,
  fecha_nacimiento: null,
  tipo_sangre: null,
  genero: null,
  ciudadania: null,
  direccion: null,
  created_at: version,
  updated_at: version,
};
const result = (data: unknown) => ({ data, error: null });

function setup(rows: unknown[] = [user]) {
  const from = createSupabaseFromMock(rows.map(result));
  const getUserById = jest
    .fn()
    .mockResolvedValue({ data: { user: { email: 'old@example.com' } }, error: null });
  const updateUserById = jest
    .fn()
    .mockImplementation((_id, attributes) =>
      Promise.resolve({ data: { user: { email: attributes.email } }, error: null }),
    );
  const rpc = jest.fn();
  const db = { from, rpc, auth: { admin: { getUserById, updateUserById } } };
  const service = new StudentAdminService(db as unknown as SupabaseClient<Database>);
  return { service, db, rpc, from, getUserById, updateUserById };
}

describe('StudentAdminService', () => {
  it('lists through one RPC, without Auth or per-row requests', async () => {
    const s = setup();
    const page = { items: [], total: 0, page: 1, pageSize: 20 };
    s.rpc.mockResolvedValue(result(page));
    expect(
      await s.service.list(actorId, {
        q: '+593',
        activo: false,
        documentosPendientes: true,
        page: 1,
        pageSize: 20,
      }),
    ).toEqual(page);
    expect(s.rpc).toHaveBeenCalledWith(
      'list_admin_students',
      expect.objectContaining({
        p_actor: actorId,
        p_q: '+593',
        p_active: false,
        p_documents_pending: true,
        p_history: false,
      }),
    );
    expect(s.from).not.toHaveBeenCalled();
    expect(s.getUserById).not.toHaveBeenCalled();
  });

  it('loads expanded profile and batched details using the shared calculations', async () => {
    const enrollments = [
      {
        id: 'e1',
        student_id: studentId,
        course_id: 'c1',
        course_type: 'A',
        cohort_id: 'h1',
        status: 'activo',
        fecha_inscripcion: version,
        monto_total: '100',
        descuento: '20',
        monto_abonado: '30',
      },
      {
        id: 'e2',
        student_id: studentId,
        course_id: 'c2',
        course_type: 'B',
        cohort_id: null,
        status: 'pendiente_cohorte',
        fecha_inscripcion: version,
        monto_total: null,
        descuento: '0',
        monto_abonado: '500',
      },
    ];
    const s = setup([
      user,
      enrollments,
      [
        {
          enrollment_id: 'e1',
          tipo: 'cedula',
          estado: 'pendiente',
          fecha_marcado: null,
          marcado_por: null,
        },
      ],
      [
        { id: 'c1', nombre: 'Curso A', tipo: 'A' },
        { id: 'c2', nombre: 'Curso B', tipo: 'B' },
      ],
      [
        {
          id: 'h1',
          nombre: 'Cohorte A',
          fecha_inicio_curso: '2026-01-01',
          fecha_fin_curso: '2027-01-01',
        },
      ],
    ]);
    const detail = await s.service.get(studentId);
    expect(detail.correo).toBe('old@example.com');
    expect(detail.updatedAt).toBe(version);
    expect(detail.enrollments[0]).toMatchObject({
      precioBruto: 120,
      montoTotal: 100,
      saldo: 70,
      documentosPendientes: 1,
    });
    expect(detail.enrollments[1]).toMatchObject({ saldo: null, montoAbonado: 500, cohorte: null });
    expect(s.getUserById).toHaveBeenCalledTimes(1);
    expect(s.from).toHaveBeenCalledTimes(5);
  });

  it('keeps students without enrollments in the detail', async () => {
    const s = setup([user, []]);
    expect((await s.service.get(studentId)).enrollments).toEqual([]);
    expect(s.from).toHaveBeenCalledTimes(2);
  });

  it.each(['rejection', 'network'])('keeps the detail available on Auth %s', async (failure) => {
    const s = setup([user, []]);
    if (failure === 'network') s.getUserById.mockRejectedValue(new Error('unavailable'));
    else s.getUserById.mockResolvedValue({ data: { user: null }, error: { message: 'unavailable' } });
    const log = jest.spyOn(console, 'warn').mockImplementation();
    try {
      expect(await s.service.get(studentId)).toMatchObject({ correo: null, correoDisponible: false });
      expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'student_email_unavailable', student_id: studentId }));
    } finally { log.mockRestore(); }
  });

  it('hides schema details from the public error and logs the diagnostic code', async () => {
    const s = setup();
    s.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    const log = jest.spyOn(console, 'error').mockImplementation();
    try {
      await expect(s.service.list(actorId, { page: 1, pageSize: 20 })).rejects.toMatchObject({
        statusCode: 503, message: 'No se pudo consultar estudiantes. Inténtalo nuevamente',
      });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('PGRST202'));
    } finally { log.mockRestore(); }
  });

  it('returns 404 before Auth if the target is absent or not a student', async () => {
    const s = setup([null]);
    await expect(s.service.get(studentId)).rejects.toMatchObject({ statusCode: 404 });
    expect(s.getUserById).not.toHaveBeenCalled();
  });
});
