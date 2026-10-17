import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { StudentProfileService } from '../../src/services/studentProfile.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';

const id = '22222222-2222-4222-8222-222222222222';
const actor = '11111111-1111-4111-8111-111111111111';
const version = '2026-10-01T10:00:00.123456+00:00';
const row = { id, rol: 'estudiante', updated_at: version };
const ok = (data: unknown) => ({ data, error: null });
function setup(rows: unknown[] = [row]) {
  const from = createSupabaseFromMock(rows.map(ok));
  const rpc = jest.fn().mockResolvedValue(ok({ updatedAt: version, changedFields: ['correo'] }));
  const getUserById = jest.fn().mockResolvedValue(ok({ user: { email: 'old@example.com' } }));
  const updateUserById = jest.fn().mockResolvedValue(ok({ user: {} }));
  const db = { from, rpc, auth: { admin: { getUserById, updateUserById } } };
  return {
    from,
    rpc,
    getUserById,
    updateUserById,
    service: new StudentProfileService(db as unknown as SupabaseClient<Database>),
  };
}
describe('StudentProfileService A2', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());
  it('passes the exact six-decimal version and a backend UUID; profile-only never calls Auth', async () => {
    const s = setup();
    await s.service.update(actor, id, { updatedAt: version, nombreCompleto: 'Nuevo' });
    expect(s.rpc).toHaveBeenCalledWith(
      'save_student_profile',
      expect.objectContaining({
        p_base_version: version,
        p_profile: { nombre_completo: 'Nuevo' },
        p_email_changed: false,
        p_operation: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
    expect(s.getUserById).not.toHaveBeenCalled();
    expect(s.updateUserById).not.toHaveBeenCalled();
  });
  it('rejects invalid cédula before Auth', async () => {
    const s = setup();
    await expect(
      s.service.update(actor, id, {
        updatedAt: version,
        cedula: '1710034060',
        correo: 'new@example.com',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(s.from).not.toHaveBeenCalled();
    expect(s.updateUserById).not.toHaveBeenCalled();
  });
  it('rejects duplicate cédula across all users before Auth', async () => {
    const s = setup([row, { id: 'instructor-id' }]);
    await expect(
      s.service.update(actor, id, {
        updatedAt: version,
        cedula: '1710034065',
        correo: 'new@example.com',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(s.getUserById).not.toHaveBeenCalled();
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it('rejects stale or millisecond-truncated versions before Auth', async () => {
    const s = setup();
    await expect(
      s.service.update(actor, id, {
        updatedAt: new Date(version).toISOString(),
        correo: 'new@example.com',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(s.updateUserById).not.toHaveBeenCalled();
  });
  it('logs only identifiers and the field before changing Auth', async () => {
    const s = setup();
    await s.service.update(actor, id, { updatedAt: version, correo: 'new@example.com' });
    const operation = s.rpc.mock.calls[0][1].p_operation;
    expect(console.warn).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'student_auth_email_update_start',
        student_id: id,
        operation_id: operation,
        campo: 'correo',
      }),
    );
    expect((console.warn as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      s.updateUserById.mock.invocationCallOrder[0],
    );
  });
  it('does not call SQL or compensate on explicit Auth rejection', async () => {
    const s = setup();
    s.updateUserById.mockResolvedValue({ data: {}, error: {} });
    await expect(
      s.service.update(actor, id, { updatedAt: version, correo: 'new@example.com' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.updateUserById).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['23505', 'users_cedula_unique', 409, 'La cédula ya está registrada'],
    [
      '23505',
      'student_profile_audit_pkey',
      409,
      'Conflicto de identificador de guardado. Revisa el alumno',
    ],
    ['23505', 'unexpected_unique', 503, 'No se pudo confirmar el guardado del alumno'],
    ['CD409', '', 409, 'El alumno cambió. Recarga la ficha'],
    ['22023', '', 400, 'Datos del perfil inválidos'],
    ['CD404', '', 404, 'Alumno no encontrado'],
  ])(
    'compensates once on definitive rejection %s / %s',
    async (code, constraint, statusCode, message) => {
      const s = setup();
      s.rpc.mockResolvedValue({
        data: null,
        error: {
          code,
          message: `duplicate key value violates unique constraint "${constraint}"`,
          details: 'private@example.com',
        },
      });
      await expect(
        s.service.update(actor, id, { updatedAt: version, correo: 'new@example.com' }),
      ).rejects.toMatchObject({ statusCode, message });
      expect(s.updateUserById).toHaveBeenCalledTimes(2);
      expect(s.updateUserById).toHaveBeenLastCalledWith(id, {
        email: 'old@example.com',
        email_confirm: true,
      });
      expect(s.from).toHaveBeenCalledTimes(1);
      expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toMatch(
        /private@example|old@example|new@example/,
      );
    },
  );
  it.each(['57014', '08006', 'PGRST000', '', '42501', '42P01', '22007', '22001'])(
    'requires manual review without compensation or audit lookup on %s',
    async (code) => {
      const s = setup();
      s.rpc.mockResolvedValue({ data: null, error: { code } });
      await expect(
        s.service.update(actor, id, { updatedAt: version, correo: 'new@example.com' }),
      ).rejects.toMatchObject({
        statusCode: 503,
        message: expect.stringContaining('Revisar manualmente'),
      });
      expect(s.updateUserById).toHaveBeenCalledTimes(1);
      expect(s.from).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        JSON.stringify({
          event: 'student_profile_manual_review_required',
          student_id: id,
          operation_id: s.rpc.mock.calls[0][1].p_operation,
          ...(code ? { code } : {}),
        }),
      );
    },
  );
  it('does not compensate or consult audit after an RPC network exception', async () => {
    const s = setup();
    s.rpc.mockRejectedValue(new Error('timeout'));
    await expect(
      s.service.update(actor, id, { updatedAt: version, correo: 'new@example.com' }),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining('Revisar manualmente'),
    });
    expect(s.updateUserById).toHaveBeenCalledTimes(1);
    expect(s.from).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'student_profile_manual_review_required',
        student_id: id,
        operation_id: s.rpc.mock.calls[0][1].p_operation,
      }),
    );
  });
  it('reports a failed compensation without retrying', async () => {
    const s = setup();
    s.rpc.mockResolvedValue({ data: null, error: { code: 'CD409' } });
    s.updateUserById
      .mockResolvedValueOnce(ok({ user: {} }))
      .mockRejectedValueOnce(new Error('network'));
    await expect(
      s.service.update(actor, id, { updatedAt: version, correo: 'new@example.com' }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(s.updateUserById).toHaveBeenCalledTimes(2);
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toMatch(
      /old@example|new@example/,
    );
  });
  it.each([
    ['email_exists', 409, 'EMAIL_DUPLICATE', 'correo'],
    ['user_already_exists', 409, 'EMAIL_DUPLICATE', 'correo'],
    ['validation_failed', 400, 'AUTH_REJECTED', undefined],
  ])('exposes stable Auth code for %s', async (authCode, statusCode, code, field) => {
    const s = setup();
    s.updateUserById.mockResolvedValue({ data: {}, error: { code: authCode } });
    await expect(
      s.service.update(actor, id, { updatedAt: version, correo: 'new@example.com' }),
    ).rejects.toMatchObject({ statusCode, code, field });
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.updateUserById).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['23505', 'users_cedula_unique', 'CEDULA_DUPLICATE', 'cedula'],
    ['CD409', '', 'VERSION_CONFLICT', undefined],
    ['22023', '', 'INVALID_FIELD', undefined],
    ['57014', '', 'UNCONFIRMED', undefined],
  ])('exposes stable RPC code for %s', async (sqlCode, constraint, code, field) => {
    const s = setup();
    s.rpc.mockResolvedValue({
      data: null,
      error: {
        code: sqlCode,
        message: `duplicate key value violates unique constraint "${constraint}"`,
      },
    });
    await expect(
      s.service.update(actor, id, { updatedAt: version, nombreCompleto: 'Nuevo' }),
    ).rejects.toMatchObject({ code, field });
  });
});
