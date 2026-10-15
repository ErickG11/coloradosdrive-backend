import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import {
  StudentDeletionService,
  assertStudentMutable,
  type StudentDeletionOperation,
} from '../../src/services/studentDeletion.service';
import { StudentProfileService } from '../../src/services/studentProfile.service';
import { StudentAccessService } from '../../src/services/studentAccess.service';
import { ManualEnrollmentService } from '../../src/services/manualEnrollment.service';
import type { EmailService } from '../../src/services/email.service';
import type { ManualEnrollmentInput } from '../../src/models/manualEnrollment.model';
import { createChain } from '../helpers/supabaseMock';
const student = '22222222-2222-4222-8222-222222222222',
  actor = '11111111-1111-4111-8111-111111111111';
const confirmation = '1710034065';
function fixture(phase: StudentDeletionOperation['phase'] = 'bloqueo') {
  let tick = 1;
  let op: StudentDeletionOperation = {
    student_id: student,
    actor_id: actor,
    confirmed_at: '2026-10-15T00:00:00.000001Z',
    phase,
    status: phase === 'completo' ? 'completo' : 'pendiente',
    retry_count: 0,
    last_retry_actor_id: null,
    last_retry_at: null,
    data_deleted_by: null,
    data_deleted_at: null,
    updated_at: '2026-10-15T00:00:00.000001Z',
  };
  const events: string[] = [];
  const set = (next: Partial<StudentDeletionOperation>) => {
    op = { ...op, ...next, updated_at: `2026-10-15T00:00:00.${String(++tick).padStart(6, '0')}Z` };
  };
  const rpc = jest.fn(
    (
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ data: StudentDeletionOperation | string[] | null; error: unknown }> => {
      events.push(name);
      if (name === 'student_deletion_storage_paths')
        return Promise.resolve({ data: ['fixture/document.pdf'], error: null });
      if (name === 'delete_student_data')
        set({ phase: 'auth', data_deleted_by: actor, data_deleted_at: '2026-10-15T00:01:00Z' });
      if (name === 'advance_student_deletion') {
        if (args.p_next === 'fallido') set({ status: 'fallido' });
        else
          set({
            phase: args.p_next as StudentDeletionOperation['phase'],
            status: args.p_next === 'completo' ? 'completo' : 'pendiente',
          });
      }
      return Promise.resolve({ data: { ...op }, error: null });
    },
  );
  const ban = jest.fn((): Promise<{ data: Record<string, unknown>; error: unknown }> => {
    events.push('ban');
    return Promise.resolve({ data: {}, error: null });
  });
  const deleteUser = jest.fn((): Promise<{ data: Record<string, unknown>; error: unknown }> => {
    events.push('auth-delete');
    return Promise.resolve({ data: {}, error: null });
  });
  const remove = jest.fn((): Promise<{ data: unknown[]; error: unknown }> => {
    events.push('storage');
    return Promise.resolve({ data: [], error: null });
  });
  const from = jest.fn<ReturnType<typeof createChain>, [string]>(() =>
    createChain({ data: { ...op }, error: null }),
  );
  const db = {
    rpc,
    from,
    auth: { admin: { updateUserById: ban, deleteUser } },
    storage: { from: jest.fn(() => ({ remove })) },
  } as unknown as SupabaseClient<Database>;
  return {
    rpc,
    ban,
    deleteUser,
    remove,
    from,
    events,
    set,
    db,
    get: () => op,
    service: new StudentDeletionService(db),
  };
}
describe('D por petición del admin', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation());
  afterEach(() => jest.restoreAllMocks());
  it('confirma por RPC y ejecuta bloqueo → Storage → datos → Auth → completo', async () => {
    const f = fixture();
    expect((await f.service.remove(actor, student, confirmation)).status).toBe('completo');
    expect(f.rpc).toHaveBeenNthCalledWith(1, 'begin_student_deletion', {
      p_actor: actor,
      p_student: student,
      p_confirmation: confirmation,
    });
    expect(f.events).toEqual([
      'begin_student_deletion',
      'ban',
      'advance_student_deletion',
      'student_deletion_storage_paths',
      'storage',
      'delete_student_data',
      'auth-delete',
      'advance_student_deletion',
    ]);
    expect(f.db.storage.from).toHaveBeenCalledWith('solicitudes-documentos');
    expect(f.remove).toHaveBeenCalledWith(['fixture/document.pdf']);
    const logs = (console.error as jest.Mock).mock.calls.map(
      (c) => JSON.parse(c[0] as string) as Record<string, unknown>,
    );
    expect(
      logs.every((l) =>
        Object.keys(l).every((k) =>
          ['event', 'student_id', 'actor_id', 'phase', 'code'].includes(k),
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(confirmation);
  });
  it.each(['CD031', 'CD404', '42501'])(
    'rechazo %s no ejecuta efectos ni imprime la confirmación',
    async (code) => {
      const f = fixture();
      f.rpc.mockResolvedValueOnce({ data: null, error: { code } });
      await expect(f.service.remove(actor, student, confirmation)).rejects.toMatchObject({
        statusCode: code === 'CD031' ? 400 : code === 'CD404' ? 404 : 403,
      });
      expect(f.ban).not.toHaveBeenCalled();
      expect(f.remove).not.toHaveBeenCalled();
      expect(f.deleteUser).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    },
  );
  it('404 de ban/Storage/Auth cuenta como ausencia confirmada', async () => {
    const f = fixture();
    f.ban.mockResolvedValue({ data: {}, error: { status: 404 } });
    f.remove.mockResolvedValue({ data: [], error: { statusCode: '404' } });
    f.deleteUser.mockResolvedValue({ data: {}, error: { code: 'user_not_found' } });
    expect((await f.service.remove(actor, student, confirmation)).status).toBe('completo');
  });
  it('ban rechazado impide tocar Storage/datos y registra fallido sin bucle', async () => {
    const f = fixture();
    f.ban.mockResolvedValue({ data: {}, error: { status: 403, message: confirmation } });
    await expect(f.service.remove(actor, student, confirmation)).rejects.toMatchObject({
      statusCode: 503,
      code: 'DELETION_INCOMPLETE',
    });
    expect(f.ban).toHaveBeenCalledTimes(1);
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.get().status).toBe('fallido');
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain(confirmation);
  });
  it.each(['bloqueo', 'storage', 'auth'] as const)(
    'solo un reintento automático en fallo persistente de %s',
    async (phase) => {
      const f = fixture(phase);
      const call = phase === 'bloqueo' ? f.ban : phase === 'storage' ? f.remove : f.deleteUser;
      call.mockRejectedValue(new Error('network'));
      await expect(f.service.remove(actor, student)).rejects.toMatchObject({ statusCode: 503 });
      expect(call).toHaveBeenCalledTimes(2);
      expect(f.get().status).toBe('fallido');
      expect(f.from).toHaveBeenCalledTimes(1);
    },
  );
  it('presupuesto automático es de toda la petición, no uno por fase', async () => {
    const f = fixture();
    f.ban.mockRejectedValueOnce(new Error('network'));
    f.remove.mockRejectedValue(new Error('network'));
    await expect(f.service.remove(actor, student, confirmation)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(f.ban).toHaveBeenCalledTimes(2);
    expect(f.remove).toHaveBeenCalledTimes(1);
  });
  it('CAS contendido consume el mismo presupuesto: nunca más de dos bans', async () => {
    const f = fixture(),
      original = f.rpc.getMockImplementation();
    if (!original) throw new Error('Fixture RPC missing');
    f.rpc.mockImplementation((name, args) => {
      if (name === 'advance_student_deletion' && args.p_next === 'storage') {
        f.set({ phase: 'bloqueo' });
        return Promise.resolve({ data: { ...f.get() }, error: null });
      }
      return original(name, args);
    });
    await expect(f.service.remove(actor, student)).rejects.toMatchObject({ statusCode: 503 });
    expect(f.ban).toHaveBeenCalledTimes(2);
    expect(f.remove).not.toHaveBeenCalled();
  });
  it('RPC datos confirma y pierde respuesta: relee fase Auth y no repite datos', async () => {
    const f = fixture('storage'),
      original = f.rpc.getMockImplementation();
    if (!original) throw new Error('Fixture RPC missing');
    f.rpc.mockImplementation(async (name, args) => {
      const result = await original(name, args);
      if (name === 'delete_student_data') throw new Error('response lost');
      return result;
    });
    expect((await f.service.remove(actor, student)).status).toBe('completo');
    expect(f.events.filter((x) => x === 'delete_student_data')).toHaveLength(1);
    expect(f.deleteUser).toHaveBeenCalledTimes(1);
  });
  it('rutas cambiadas se releen antes del único reintento', async () => {
    const f = fixture('storage'),
      original = f.rpc.getMockImplementation();
    if (!original) throw new Error('Fixture RPC missing');
    let changed = false;
    f.rpc.mockImplementation(async (name, args) => {
      if (name === 'delete_student_data' && !changed) {
        changed = true;
        return { data: null, error: { code: 'CD032' } };
      }
      return original(name, args);
    });
    expect((await f.service.remove(actor, student)).status).toBe('completo');
    expect(f.events.filter((x) => x === 'student_deletion_storage_paths')).toHaveLength(2);
  });
  it('un RESTRICT en datos deja Storage pendiente y no elimina Auth ni repite automáticamente', async () => {
    const f = fixture('storage'),
      original = f.rpc.getMockImplementation();
    if (!original) throw new Error('Fixture RPC missing');
    f.rpc.mockImplementation((name, args) =>
      name === 'delete_student_data'
        ? Promise.resolve({ data: null, error: { code: '23503' } })
        : original(name, args),
    );
    await expect(f.service.remove(actor, student)).rejects.toMatchObject({
      code: 'DELETION_INCOMPLETE',
    });
    expect(f.get()).toMatchObject({ phase: 'storage', status: 'fallido' });
    expect(f.deleteUser).not.toHaveBeenCalled();
    expect(f.remove).toHaveBeenCalledTimes(1);
  });
  it('Auth elimina pero pierde respuesta: el único reintento acepta 404', async () => {
    const f = fixture('auth');
    f.deleteUser
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ data: {}, error: { status: 404 } });
    expect((await f.service.remove(actor, student)).status).toBe('completo');
    expect(f.deleteUser).toHaveBeenCalledTimes(2);
  });
  it('completo pierde respuesta: releer evita volver a eliminar Auth o marcar fallido', async () => {
    const f = fixture('auth'),
      original = f.rpc.getMockImplementation();
    if (!original) throw new Error('Fixture RPC missing');
    f.rpc.mockImplementation(async (name, args) => {
      const r = await original(name, args);
      if (name === 'advance_student_deletion' && args.p_next === 'completo')
        throw new Error('response lost');
      return r;
    });
    expect((await f.service.remove(actor, student)).status).toBe('completo');
    expect(f.deleteUser).toHaveBeenCalledTimes(1);
  });
  it('reanuda Auth sin leer perfil ni Storage; registra admin del reintento', async () => {
    const f = fixture('auth');
    f.set({ retry_count: 2, last_retry_actor_id: actor });
    expect((await f.service.remove(actor, student)).status).toBe('completo');
    expect(f.ban).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenNthCalledWith(
      1,
      'begin_student_deletion',
      expect.objectContaining({ p_confirmation: null }),
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('student_deletion_retry'));
  });
  it('completo no cambia ni ejecuta efectos otra vez', async () => {
    const f = fixture('completo'),
      before = { ...f.get() };
    expect(await f.service.remove(actor, student)).toEqual(before);
    expect(f.events).toEqual(['begin_student_deletion']);
    expect(console.error).not.toHaveBeenCalled();
  });
  it('fallo al iniciar es incierto: ningún efecto y log sin valores', async () => {
    const f = fixture();
    f.rpc.mockRejectedValue(new Error(confirmation));
    await expect(f.service.remove(actor, student, confirmation)).rejects.toMatchObject({
      statusCode: 503,
      code: 'UNCONFIRMED',
    });
    expect(f.events).toEqual([]);
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain(confirmation);
  });
  it('listado sin perfil, estados pendientes y orden/paginación estables', async () => {
    const f = fixture('auth'),
      chain = createChain({ data: [f.get()], error: null, count: 1 });
    f.from.mockReturnValue(chain);
    expect(await f.service.list(2, 5)).toMatchObject({
      items: [f.get()],
      total: 1,
      page: 2,
      pageSize: 5,
    });
    expect(f.from).toHaveBeenCalledWith('student_deletion_operations');
    expect(chain.in).toHaveBeenCalledWith('status', ['pendiente', 'fallido']);
    expect(chain.range).toHaveBeenCalledWith(5, 9);
    expect(chain.order).toHaveBeenNthCalledWith(1, 'updated_at', { ascending: false });
    expect(chain.order).toHaveBeenNthCalledWith(2, 'student_id');
  });
  it.each(['perfil', 'reactivación', 'matrícula'])(
    'guard previo bloquea %s antes de Auth/reservas',
    async (kind) => {
      const f = fixture();
      const call =
        kind === 'perfil'
          ? new StudentProfileService(f.db).update(actor, student, {
              updatedAt: '2026-10-15T00:00:00Z',
              correo: 'fixture@example.test',
            })
          : kind === 'reactivación'
            ? new StudentAccessService(f.db).setActive(actor, student, true)
            : new ManualEnrollmentService(f.db, {} as EmailService).confirm(actor, student, {
                student: { mode: 'existing', id: student },
              } as ManualEnrollmentInput);
      await expect(call).rejects.toMatchObject({ statusCode: 409, code: 'DELETION_PENDING' });
      expect(f.rpc).not.toHaveBeenCalled();
      expect(f.ban).not.toHaveBeenCalled();
    },
  );
  it('guard falla cerrado si la consulta no responde', async () => {
    const f = fixture();
    f.from.mockReturnValue(createChain({ data: null, error: { code: '57014' } }));
    await expect(assertStudentMutable(f.db, student)).rejects.toMatchObject({ statusCode: 503 });
  });
  it('si D comienza durante el unban, vuelve a banear y no activa en SQL', async () => {
    const f = fixture(),
      empty = createChain({ data: null, error: null });
    f.from
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(createChain({ data: { id: student }, error: null }));
    await expect(
      new StudentAccessService(f.db).setActive(actor, student, true),
    ).rejects.toMatchObject({ code: 'DELETION_PENDING' });
    expect(f.ban).toHaveBeenNthCalledWith(1, student, { ban_duration: 'none' });
    expect(f.ban).toHaveBeenNthCalledWith(2, student, { ban_duration: '876000h' });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('si D comienza tras las comprobaciones previas, rechazo SQL de reactivación vuelve a banear', async () => {
    const f = fixture();
    f.from.mockImplementation((table: string) =>
      createChain({ data: table === 'users' ? { id: student } : null, error: null }),
    );
    f.rpc.mockResolvedValue({ data: null, error: { code: 'CD030' } });
    await expect(
      new StudentAccessService(f.db).setActive(actor, student, true),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DELETION_PENDING' });
    expect(f.ban).toHaveBeenCalledTimes(2);
    expect(f.ban).toHaveBeenLastCalledWith(student, { ban_duration: '876000h' });
  });
});
