import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { SwapPracticeRpcResult } from '../../src/models/practiceSlot.model';
import type { EmailService } from '../../src/services/email.service';
import { PracticeSlotActionService } from '../../src/services/practiceSlotAction.service';
import type { RealtimeService } from '../../src/services/realtime.service';

const result: SwapPracticeRpcResult = {
  slot: { id: 'target', cohort_id: 'cohort', instructor_id: 'instructor', student_id: 'student',
    scheduled_at: '2099-01-01T15:00:00Z', duration_minutes: 60, status: 'asignado', attended: null,
    confirmed_at: null, confirmation_notified_at: null, release_notified_at: null, created_at: '', updated_at: '' },
  caso: 'B', practicaSoltadaId: 'source', cancellationId: 'cancellation', enrollmentId: 'enrollment', reprogramacionesRestantes: 1,
};
function harness() {
  const rpc = jest.fn().mockResolvedValue({ data: result, error: null });
  const realtime = { broadcast: jest.fn().mockResolvedValue(undefined) };
  return { rpc, realtime, service: new PracticeSlotActionService(
    { rpc } as unknown as SupabaseClient<Database>, realtime as unknown as RealtimeService, {} as EmailService,
  ) };
}

describe('E2: servicio y efectos tras commit', () => {
  it('espera el commit y solo avisa al alumno y por el cupo tomado; nunca difunde el origen', async () => {
    const h = harness();
    let commit!: (value: { data: SwapPracticeRpcResult; error: null }) => void;
    h.rpc.mockReturnValue(new Promise((resolve) => { commit = resolve; }));
    const pending = h.service.swapSlot('target', 'student', 'source');
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
    commit({ data: result, error: null });
    await expect(pending).resolves.toMatchObject({ caso: 'B', practicaSoltadaId: 'source', slot: { status: 'asignado' } });
    expect(h.realtime.broadcast.mock.calls).toEqual([
      ['user-student-practice-slots', 'slots-updated', {}],
      ['cohort-cohort-practice-slots', 'slot-taken', {}],
    ]);
  });

  it('un conflicto SQL (incluido T-5) no produce ningún Broadcast', async () => {
    const h = harness();
    h.rpc.mockResolvedValue({ data: null, error: { code: 'CD409', message: 'Faltan 5 minutos o menos: el cupo ya cerró' } });
    await expect(h.service.swapSlot('target', 'student', 'source')).rejects.toMatchObject({ statusCode: 409 });
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
  });

  it('propaga el rechazo de cupo propio tanto por swap como por claim, sin avisos', async () => {
    const h = harness();
    const message = 'No puedes volver a tomar una práctica que tú mismo soltaste';
    h.rpc.mockResolvedValue({ data: null, error: { code: 'CD409', message } });
    await expect(h.service.swapSlot('target', 'student', 'source')).rejects.toMatchObject({ statusCode: 409, message });
    await expect(h.service.claimSlot('target', 'student')).rejects.toMatchObject({ statusCode: 409, message });
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'swap_practice_slot', {
      p_slot_id: 'target', p_student_id: 'student', p_source_slot_id: 'source',
    });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'swap_practice_slot', {
      p_slot_id: 'target', p_student_id: 'student', p_source_slot_id: null,
    });
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
  });

  it('si falla el aviso personal conserva el cambio y aún intenta invalidar la cohorte', async () => {
    const h = harness();
    h.realtime.broadcast.mockRejectedValueOnce(new Error('Sin conexión'));
    const log = jest.spyOn(console, 'error').mockImplementation();
    try {
      await expect(h.service.swapSlot('target', 'student', 'source')).resolves.toMatchObject({ caso: 'B' });
      expect(h.realtime.broadcast).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });

  it('el antiguo claim también usa swap sin origen (caso A), con los mismos avisos', async () => {
    const h = harness();
    h.rpc.mockResolvedValue({ data: { ...result, caso: 'A', practicaSoltadaId: null }, error: null });
    await expect(h.service.claimSlot('target', 'student')).resolves.toMatchObject({ status: 'asignado' });
    expect(h.rpc).toHaveBeenCalledWith('swap_practice_slot', {
      p_slot_id: 'target', p_student_id: 'student', p_source_slot_id: null,
    });
  });

  it('las listas consultan solo al alumno solicitado y no producen efectos', async () => {
    const h = harness();
    h.rpc.mockResolvedValue({ data: [], error: null });
    await expect(h.service.releasedForStudent('student')).resolves.toEqual([]);
    h.rpc.mockResolvedValue({ data: [{ slot: result.slot, enrollmentId: result.enrollmentId }], error: null });
    await expect(h.service.pendingForStudent('student')).resolves.toEqual([{ enrollmentId: 'enrollment',
      slot: expect.objectContaining({ id: 'target', cohortId: 'cohort' }) }]);
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
  });
});
