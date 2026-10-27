import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { NotificationRow } from '../../src/models/notification.model';
import type { EmailService } from '../../src/services/email.service';
import { NotificationEmailService } from '../../src/services/notificationEmail.service';
import { createChain } from '../helpers/supabaseMock';

const notification: NotificationRow = {
  attendance_event_id: null,
  id: 'notification', user_id: 'student', tipo: 'recordatorio_practica', titulo: 'Recordatorio', mensaje: 'Tu práctica',
  practice_slot_id: 'slot', scheduled_at: '2099-10-27T20:00:00Z', created_at: '', read_at: null,
  email_status: 'pendiente', email_attempts: 1, email_last_error: null, email_next_attempt_at: '',
  email_lease_token: 'lease', email_locked_until: '',
};
function harness(row = notification) {
  const rpc = jest.fn().mockImplementation((name: string) => name === 'claim_notification_email'
    ? createChain({ data: null, error: null }) : Promise.resolve({ data: true, error: null }));
  rpc.mockReturnValueOnce(createChain({ data: row, error: null }));
  const from = jest.fn().mockReturnValue(createChain({ data: { activo: true, nombre_completo: 'Alumno' }, error: null }));
  const getUserById = jest.fn().mockResolvedValue({ data: { user: { email: 'fixture@example.invalid' } }, error: null });
  const email = { sendPracticeConfirmationRequestEmail: jest.fn().mockResolvedValue(undefined), sendNoPracticeEmail: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationEmailService({ rpc, from, auth: { admin: { getUserById } } } as unknown as SupabaseClient<Database>, email as unknown as EmailService);
  return { rpc, from, getUserById, email, service };
}

describe('cola persistente de correos', () => {
  it('confirma el envio con su token y conserva el mismo Message-ID', async () => {
    const h = harness();
    await h.service.runOnce();
    expect(h.email.sendPracticeConfirmationRequestEmail).toHaveBeenCalledWith({
      to: 'fixture@example.invalid', nombreCompleto: 'Alumno', scheduledAt: notification.scheduled_at,
      messageId: '<notification@notifications.coloradosdrive>',
    });
    expect(h.rpc).toHaveBeenCalledWith('finish_notification_email', { p_id: 'notification', p_token: 'lease', p_error: null });
  });
  it.each([1, 2, 3])('registra el error del intento %i sin borrar el aviso ni repetir sin concesion', async (attempt) => {
    const h = harness({ ...notification, email_attempts: attempt });
    h.email.sendPracticeConfirmationRequestEmail.mockRejectedValue(new Error('SMTP no disponible'));
    await h.service.runOnce();
    expect(h.email.sendPracticeConfirmationRequestEmail).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('finish_notification_email', {
      p_id: 'notification', p_token: 'lease', p_error: 'SMTP no disponible',
    });
  });
  it('un destinatario desactivado no recibe correo', async () => {
    const h = harness();
    h.from.mockReturnValue(createChain({ data: { activo: false }, error: null }));
    await h.service.runOnce();
    expect(h.email.sendPracticeConfirmationRequestEmail).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('finish_notification_email', expect.objectContaining({ p_error: 'Destinatario inactivo o inexistente' }));
  });
  it('procesa el aviso de bloque vacio al instructor', async () => {
    const h = harness({ ...notification, tipo: 'sin_practica_instructor' });
    await h.service.runOnce();
    expect(h.email.sendNoPracticeEmail).toHaveBeenCalledTimes(1);
  });
  it('si falla confirmar el envio informa el error y la concesion queda recuperable en base', async () => {
    const h = harness();
    h.rpc.mockImplementation((name: string) => name === 'finish_notification_email'
      ? Promise.resolve({ data: null, error: new Error('Base no disponible') }) : createChain({ data: null, error: null }));
    await expect(h.service.runOnce()).rejects.toThrow('Base no disponible');
    expect(h.email.sendPracticeConfirmationRequestEmail).toHaveBeenCalledTimes(1);
  });
  it('informa si otro proceso recupero la reserva antes de confirmar', async () => {
    const h = harness();
    h.rpc.mockImplementation(() => Promise.resolve({ data: false, error: null }));
    await expect(h.service.runOnce()).rejects.toThrow('La reserva del correo cambió');
  });
});
