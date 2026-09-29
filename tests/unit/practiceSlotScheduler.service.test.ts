import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { EmailService } from '../../src/services/email.service';
import { PracticeSlotSchedulerService } from '../../src/services/practiceSlotScheduler.service';
import type { RealtimeService } from '../../src/services/realtime.service';
import { createChain, type ChainResult } from '../helpers/supabaseMock';

type Row = Database['public']['Tables']['practice_slots']['Row'];
type Transition = 'remind' | 'close' | 'complete';
const slot: Row = {
  id: 'slot-1', cohort_id: 'cohort-1', instructor_id: 'instructor-1', student_id: 'student-1',
  scheduled_at: '2026-03-01T10:00:00Z', duration_minutes: 60, status: 'asignado',
  confirmation_notified_at: null, release_notified_at: null, confirmed_at: null, attended: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
function harness(phase?: Transition, result: ChainResult = { data: slot, error: null },
  snapshot: Row = phase === 'complete' ? { ...slot, status: 'confirmado' } : slot) {
  const rpc = jest.fn().mockImplementation((name, args) => {
    if (name === 'practice_slots_scheduler_candidates') {
      return Promise.resolve({ data: args.p_transition === phase ? [{ slot: snapshot, row_version: '123' }] : [], error: null });
    }
    return createChain(result);
  });
  const from = jest.fn().mockReturnValue(createChain({ data: { nombre_completo: 'Usuario de prueba' }, error: null }));
  const getUserById = jest.fn().mockResolvedValue({ data: { user: { email: 'fixture@example.invalid' } }, error: null });
  const email = { sendPracticeConfirmationRequestEmail: jest.fn().mockResolvedValue(undefined),
    sendNoPracticeEmail: jest.fn().mockResolvedValue(undefined) };
  const realtime = { broadcast: jest.fn().mockResolvedValue(undefined) };
  const service = new PracticeSlotSchedulerService(
    { rpc, from, auth: { admin: { getUserById } } } as unknown as SupabaseClient<Database>,
    email as unknown as EmailService, realtime as unknown as RealtimeService,
  );
  return { service, rpc, from, email, realtime };
}

describe('PracticeSlotSchedulerService: RPC y efectos tras transición', () => {
  it('consulta las tres fases en PostgreSQL sin escribir ni notificar si no hay candidatos', async () => {
    const { service, rpc, from, email, realtime } = harness();
    await service.runOnce();
    expect(rpc.mock.calls).toEqual([
      ['practice_slots_scheduler_candidates', { p_transition: 'remind' }],
      ['practice_slots_scheduler_candidates', { p_transition: 'close' }],
      ['practice_slots_scheduler_candidates', { p_transition: 'complete' }],
    ]);
    expect(from).not.toHaveBeenCalled();
    expect(email.sendNoPracticeEmail).not.toHaveBeenCalled();
    expect(realtime.broadcast).not.toHaveBeenCalled();
  });

  it.each(['remind', 'close', 'complete'] as const)('%s pierde una carrera: cero efectos secundarios', async (phase) => {
    const { service, rpc, from, email, realtime } = harness(phase, { data: null, error: null });
    await service.runOnce();
    expect(rpc).toHaveBeenCalledWith('transition_practice_slot_for_scheduler', {
      p_slot_id: slot.id, p_transition: phase, p_expected_version: '123',
    });
    expect(from).not.toHaveBeenCalled();
    expect(email.sendPracticeConfirmationRequestEmail).not.toHaveBeenCalled();
    expect(email.sendNoPracticeEmail).not.toHaveBeenCalled();
    expect(realtime.broadcast).not.toHaveBeenCalled();
  });

  it('recordatorio: no envía nada hasta recibir la transición confirmada', async () => {
    const h = harness('remind');
    let completeWrite!: (value: ChainResult) => void;
    const pendingWrite = new Promise<ChainResult>((resolve) => { completeWrite = resolve; });
    const original = h.rpc.getMockImplementation();
    if (original === undefined) { throw new Error('Mock de RPC no configurado'); }
    h.rpc.mockImplementation((name, args): unknown => name === 'transition_practice_slot_for_scheduler'
      ? { maybeSingle: () => pendingWrite } : original(name, args));
    const running = h.service.runOnce();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.email.sendPracticeConfirmationRequestEmail).not.toHaveBeenCalled();
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
    completeWrite({ data: { ...slot, confirmation_notified_at: '2026-03-01T09:40:00Z' }, error: null });
    await running;
    expect(h.email.sendPracticeConfirmationRequestEmail).toHaveBeenCalledWith({
      to: 'fixture@example.invalid', nombreCompleto: 'Usuario de prueba', scheduledAt: slot.scheduled_at,
    });
    expect(h.realtime.broadcast).toHaveBeenCalledWith('user-student-1-practice-slots',
      'confirmation-requested', { scheduledAt: slot.scheduled_at });
  });

  it('cerrar una asignada avisa al estudiante de la versión aceptada y al instructor', async () => {
    const h = harness('close', { data: { ...slot, status: 'sin_practica', student_id: null }, error: null });
    await h.service.runOnce();
    expect(h.email.sendNoPracticeEmail).toHaveBeenCalledTimes(1);
    expect(h.realtime.broadcast.mock.calls).toEqual([
      ['user-student-1-practice-slots', 'no-practice', { scheduledAt: slot.scheduled_at }],
      ['user-instructor-1-practice-slots', 'no-practice', { scheduledAt: slot.scheduled_at }],
    ]);
  });

  it('completar una confirmada no emite notificaciones', async () => {
    const h = harness('complete', { data: { ...slot, status: 'completado' }, error: null });
    await h.service.runOnce();
    expect(h.from).not.toHaveBeenCalled();
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
  });

  it.each(['disponible', 'liberado'] as const)('cerrar %s solo avisa al instructor', async (status) => {
    const snapshot: Row = { ...slot, status, student_id: null };
    const h = harness('close', { data: { ...snapshot, status: 'sin_practica' }, error: null }, snapshot);
    await h.service.runOnce();
    expect(h.email.sendNoPracticeEmail).toHaveBeenCalledTimes(1);
    expect(h.realtime.broadcast.mock.calls).toEqual([
      ['user-instructor-1-practice-slots', 'no-practice', { scheduledAt: slot.scheduled_at }],
    ]);
  });

  it('un error de escritura no genera efectos ni se presenta como transición omitida', async () => {
    const error = { code: 'XX000', message: 'error simulado' };
    const h = harness('close', { data: null, error });
    await expect(h.service.runOnce()).rejects.toEqual(error);
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
    expect(h.email.sendNoPracticeEmail).not.toHaveBeenCalled();
  });

  it('un error al consultar candidatos detiene la pasada sin efectos', async () => {
    const error = { code: 'XX000', message: 'error simulado' };
    const h = harness();
    h.rpc.mockResolvedValueOnce({ data: null, error });
    await expect(h.service.runOnce()).rejects.toEqual(error);
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
  });

  it('el correo fallido sigue siendo best-effort y permite el broadcast tras el commit', async () => {
    const h = harness('remind');
    h.email.sendPracticeConfirmationRequestEmail.mockRejectedValueOnce(new Error('fallo simulado'));
    const logger = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await h.service.runOnce();
      expect(h.realtime.broadcast).toHaveBeenCalledTimes(1);
    } finally { logger.mockRestore(); }
  });
});
