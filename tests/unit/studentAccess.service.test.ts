import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { StudentAccessService } from '../../src/services/studentAccess.service';
import { createChain, createSupabaseFromMock } from '../helpers/supabaseMock';
const student = '22222222-2222-4222-8222-222222222222',
  actor = '11111111-1111-4111-8111-111111111111';
function setup(rows: unknown[] = [{ id: student }]) {
  const reads = createSupabaseFromMock(rows.map((data) => ({ data, error: null })));
  const from = jest.fn((table: string) =>
    table === 'student_deletion_operations'
      ? createChain({ data: null, error: null })
      : (reads(table) as ReturnType<typeof createChain>),
  );
  const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
  const updateUserById = jest.fn().mockResolvedValue({ data: { user: {} }, error: null });
  const db = { from, rpc, auth: { admin: { updateUserById } } };
  return {
    from,
    rpc,
    updateUserById,
    service: new StudentAccessService(db as unknown as SupabaseClient<Database>),
  };
}
describe('StudentAccessService B', () => {
  afterEach(() => jest.restoreAllMocks());
  it('closes SQL first and bans Auth afterwards on deactivation', async () => {
    const s = setup();
    expect(await s.service.setActive(actor, student, false)).toMatchObject({ activo: false });
    expect(s.rpc).toHaveBeenCalledWith('set_student_active', {
      p_actor: actor,
      p_student: student,
      p_active: false,
    });
    expect(s.updateUserById).toHaveBeenCalledWith(student, { ban_duration: '876000h' });
    expect(s.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      s.updateUserById.mock.invocationCallOrder[0],
    );
  });
  it('unbans, activates, then restores each deactivation reservation without failing for conflicts', async () => {
    const s = setup([{ id: student }, { id: student }, [{ slot_id: 's1' }, { slot_id: 's2' }]]);
    s.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { slotId: 's1', status: 'restaurada' }, error: null })
      .mockResolvedValueOnce({
        data: { slotId: 's2', status: 'pendiente_reprogramar', reason: 'ocupada' },
        error: null,
      });
    expect(await s.service.setActive(actor, student, true)).toEqual({
      id: student,
      activo: true,
      reservas: [
        { slotId: 's1', status: 'restaurada' },
        { slotId: 's2', status: 'pendiente_reprogramar', reason: 'ocupada' },
      ],
      recuperacionPendiente: false,
    });
    expect(s.updateUserById).toHaveBeenCalledWith(student, { ban_duration: 'none' });
    expect(s.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      s.rpc.mock.invocationCallOrder[0],
    );
    expect(s.rpc).toHaveBeenNthCalledWith(2, 'restore_student_practice', {
      p_actor: actor,
      p_student: student,
      p_slot: 's1',
    });
  });
  it('reservation RPC/network failure never rolls back successful account activation', async () => {
    const s = setup([{ id: student }, { id: student }, [{ slot_id: 's1' }]]);
    s.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockRejectedValueOnce(new Error('network'));
    expect(await s.service.setActive(actor, student, true)).toMatchObject({
      activo: true,
      recuperacionPendiente: true,
    });
    expect(s.updateUserById).toHaveBeenCalledTimes(1);
  });
  it('recovery lookup failure does not reject account reactivation', async () => {
    const s = setup([{ id: student }, null]);
    expect(await s.service.setActive(actor, student, true)).toMatchObject({
      activo: true,
      recuperacionPendiente: true,
    });
  });
  it('Auth failure leaves SQL closed, reports retry, and never restores practices', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    const s = setup();
    s.updateUserById.mockRejectedValue(new Error('network'));
    await expect(s.service.setActive(actor, student, false)).rejects.toMatchObject({
      statusCode: 503,
      code: 'UNCONFIRMED',
    });
    expect(s.rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('nombre');
  });
  it('unban rejection prevents activation in SQL', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    const s = setup();
    s.updateUserById.mockResolvedValue({ data: {}, error: {} });
    await expect(s.service.setActive(actor, student, true)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it.each(['response', 'network'])(
    'reports an unconfirmed SQL %s without banning or recovery',
    async (failure) => {
      jest.spyOn(console, 'error').mockImplementation();
      const s = setup();
      if (failure === 'network') s.rpc.mockRejectedValue(new Error('network'));
      else s.rpc.mockResolvedValue({ data: null, error: { code: '57014' } });
      await expect(s.service.setActive(actor, student, false)).rejects.toMatchObject({
        statusCode: 503,
        code: 'UNCONFIRMED',
      });
      expect(s.updateUserById).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        JSON.stringify({
          event: 'student_access_sql_unconfirmed',
          student_id: student,
          active: false,
        }),
      );
    },
  );
  it('cannot ban missing profiles or other roles', async () => {
    const s = setup([null]);
    await expect(s.service.setActive(actor, student, false)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(s.updateUserById).not.toHaveBeenCalled();
    expect(s.rpc).not.toHaveBeenCalled();
  });
});
