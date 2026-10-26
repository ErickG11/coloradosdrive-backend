import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { PracticeCancellationRpcResult } from '../../src/models/practiceSlot.model';
import type { EmailService } from '../../src/services/email.service';
import { PracticeSlotActionService } from '../../src/services/practiceSlotAction.service';
import type { RealtimeService } from '../../src/services/realtime.service';
import { createChain } from '../helpers/supabaseMock';

const result: PracticeCancellationRpcResult = {
  slot: { id: 'slot', cohort_id: 'cohort', instructor_id: 'instructor', student_id: null,
    scheduled_at: '2026-10-30T15:00:00Z', duration_minutes: 60, status: 'sin_practica',
    confirmation_notified_at: null, release_notified_at: null, confirmed_at: null, attended: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-30T14:56:00Z' },
  cancellationId: 'cancellation', enrollmentId: 'enrollment', studentId: 'student',
  instructorId: 'instructor', cohortId: 'cohort', cancelledAt: '2026-10-30T14:56:00Z',
  resultado: 'falta', consumioReprogramacion: false, reprogramacionNumero: null,
  reprogramacionesRestantes: 0, difundirCohorte: false,
};
const reason = { motivoCategoria: 'salud' as const, motivoTexto: 'Tengo una consulta médica' };
function harness() {
  const rpc = jest.fn().mockResolvedValue({ data: result, error: null });
  const from = jest.fn().mockReturnValue(createChain({ data: { activo: true, nombre_completo: 'Instructor' }, error: null }));
  const getUserById = jest.fn().mockResolvedValue({ data: { user: { email: 'fixture@example.invalid' } }, error: null });
  const email = { sendNoPracticeEmail: jest.fn().mockResolvedValue(undefined) };
  const realtime = { broadcast: jest.fn().mockResolvedValue(undefined) };
  return { rpc, from, email, realtime, service: new PracticeSlotActionService(
    { rpc, from, auth: { admin: { getUserById } } } as unknown as SupabaseClient<Database>,
    realtime as unknown as RealtimeService, email as unknown as EmailService,
  ) };
}
describe('cancelación: efectos posteriores al commit', () => {
  it('a T-5 o después solo avisa al instructor por correo y plataforma', async () => {
    const h = harness();
    const response = await h.service.cancelSlot('slot', 'student', reason);
    expect(response.status).toBe('sin_practica');
    expect(response.cancelacion.resultado).toBe('falta');
    expect(h.email.sendNoPracticeEmail).toHaveBeenCalledWith({
      to: 'fixture@example.invalid', nombreCompleto: 'Instructor', scheduledAt: result.slot.scheduled_at,
    });
    expect(h.realtime.broadcast.mock.calls).toEqual([
      ['user-instructor-practice-slots', 'no-practice', { scheduledAt: result.slot.scheduled_at }],
    ]);
  });
  it('espera la respuesta de la transacción antes de notificar', async () => {
    const h = harness();
    let commit!: (value: { data: PracticeCancellationRpcResult; error: null }) => void;
    h.rpc.mockReturnValue(new Promise((resolve) => { commit = resolve; }));
    const pending = h.service.cancelSlot('slot', 'student', reason);
    expect(h.email.sendNoPracticeEmail).not.toHaveBeenCalled();
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
    commit({ data: result, error: null });
    await pending;
    expect(h.email.sendNoPracticeEmail).toHaveBeenCalledTimes(1);
  });
  it('más de 5 minutos: difunde únicamente a la cohorte según el reloj SQL', async () => {
    const h = harness();
    h.rpc.mockResolvedValue({ data: { ...result, difundirCohorte: true }, error: null });
    await h.service.cancelSlot('slot', 'student', reason);
    expect(h.email.sendNoPracticeEmail).not.toHaveBeenCalled();
    expect(h.realtime.broadcast).toHaveBeenCalledWith('cohort-cohort-practice-slots',
      'slot-released', { slotId: 'slot', scheduledAt: result.slot.scheduled_at });
  });
  it('un fallo SQL no envía ningún aviso', async () => {
    const h = harness();
    h.rpc.mockResolvedValue({ data: null, error: { code: 'CD409', message: 'La práctica ya empezó' } });
    await expect(h.service.cancelSlot('slot', 'student', reason)).rejects.toMatchObject({ statusCode: 409 });
    expect(h.email.sendNoPracticeEmail).not.toHaveBeenCalled();
    expect(h.realtime.broadcast).not.toHaveBeenCalled();
  });
  it('un fallo de correo no revierte la cancelación y permite el aviso en plataforma', async () => {
    const h = harness();
    h.email.sendNoPracticeEmail.mockRejectedValue(new Error('SMTP no disponible'));
    const log = jest.spyOn(console, 'error').mockImplementation();
    try {
      await expect(h.service.cancelSlot('slot', 'student', reason)).resolves.toMatchObject({ status: 'sin_practica' });
      expect(h.realtime.broadcast).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });
});
