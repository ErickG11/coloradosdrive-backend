import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import type { EmailService } from '../../src/services/email.service';
import { PracticeSlotSchedulerService } from '../../src/services/practiceSlotScheduler.service';
import type { RealtimeService } from '../../src/services/realtime.service';
import { createChain, type ChainResult } from '../helpers/supabaseMock';

const instructorId = 'instructor-1';
const studentId = 'student-1';

function buildSlotRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'slot-1',
    cohort_id: 'cohort-1',
    instructor_id: instructorId,
    student_id: studentId,
    scheduled_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    duration_minutes: 45,
    status: 'asignado',
    confirmation_notified_at: null,
    release_notified_at: null,
    confirmed_at: null,
    attended: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildHarness(fromResults: ChainResult[]) {
  const from = jest.fn();
  fromResults.forEach((result) => from.mockReturnValueOnce(createChain(result)));

  const getUserById = jest
    .fn()
    .mockResolvedValue({ data: { user: { email: 'user@example.com' } }, error: null });

  const supabase = {
    from,
    auth: { admin: { getUserById } },
  } as unknown as SupabaseClient<Database>;

  const emailService = {
    sendPracticeConfirmationRequestEmail: jest.fn().mockResolvedValue(undefined),
    sendNoPracticeEmail: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailService;

  const realtimeService = {
    broadcast: jest.fn().mockResolvedValue(undefined),
  } as unknown as RealtimeService;

  const service = new PracticeSlotSchedulerService(supabase, emailService, realtimeService);

  return { service, from, getUserById, emailService, realtimeService };
}

// Cada test llama a runOnce(), que corre las 3 fases en orden - se
// completan las que no son el foco del test con un resultado vacío (una
// sola consulta cada una, sin filas que procesar).
const EMPTY: ChainResult = { data: [], error: null };

describe('PracticeSlotSchedulerService', () => {
  describe('notificación de confirmación (20 minutos antes)', () => {
    it('notifica al estudiante por correo y Realtime, y marca confirmation_notified_at', async () => {
      const slot = buildSlotRow();
      const { service, from, getUserById, emailService, realtimeService } = buildHarness([
        { data: [slot], error: null }, // select de franjas a recordar
        { data: { nombre_completo: 'Ana Torres' }, error: null }, // users
        { data: null, error: null }, // update confirmation_notified_at
        EMPTY, // closeSlotsWithoutPractice: select
        EMPTY, // completeFinishedSlots: select
      ]);

      await service.runOnce();

      expect(getUserById).toHaveBeenCalledWith(studentId);
      expect(emailService.sendPracticeConfirmationRequestEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com', nombreCompleto: 'Ana Torres' }),
      );
      expect(realtimeService.broadcast).toHaveBeenCalledWith(
        `user-${studentId}-practice-slots`,
        'confirmation-requested',
        expect.any(Object),
      );
      // 5 llamadas: select recordatorio, users, update, y las 2 fases vacías.
      expect(from).toHaveBeenCalledTimes(5);
    });

    it('un fallo de correo o Realtime no impide marcar confirmation_notified_at (best-effort)', async () => {
      const slot = buildSlotRow();
      const { service, from, emailService } = buildHarness([
        { data: [slot], error: null },
        { data: { nombre_completo: 'Ana Torres' }, error: null },
        { data: null, error: null }, // update confirmation_notified_at SÍ se ejecuta
        EMPTY,
        EMPTY,
      ]);
      (emailService.sendPracticeConfirmationRequestEmail as jest.Mock).mockRejectedValue(
        new Error('smtp caído'),
      );

      await expect(service.runOnce()).resolves.toBeUndefined();
      // La consulta de update sigue ejecutándose pese al fallo de correo.
      expect(from).toHaveBeenCalledTimes(5);
    });

    it('consulta con los filtros correctos: status asignado, sin notificar todavía, y todavía no empezada', async () => {
      const { service, from } = buildHarness([EMPTY, EMPTY, EMPTY]);

      await service.runOnce();

      const selectChain = from.mock.results[0].value as ReturnType<typeof createChain>;
      expect(selectChain.eq).toHaveBeenCalledWith('status', 'asignado');
      expect(selectChain.is).toHaveBeenCalledWith('confirmation_notified_at', null);
      expect(selectChain.lte).toHaveBeenCalledWith('scheduled_at', expect.any(String));
      expect(selectChain.gt).toHaveBeenCalledWith('scheduled_at', expect.any(String));
    });
  });

  describe('cierre de franjas sin práctica (5 minutos antes)', () => {
    it('cambia a sin_practica, limpia student_id, y notifica al instructor', async () => {
      const closedRow = buildSlotRow({ status: 'sin_practica', student_id: null });
      const { service, emailService, realtimeService } = buildHarness([
        EMPTY, // notifyUpcomingConfirmations: nada que recordar
        { data: [buildSlotRow({ status: 'asignado' })], error: null }, // select a cerrar
        { data: closedRow, error: null }, // update -> sin_practica
        { data: { nombre_completo: 'Instructor Uno' }, error: null }, // users (instructor)
        EMPTY, // completeFinishedSlots
      ]);

      await service.runOnce();

      expect(emailService.sendNoPracticeEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com', nombreCompleto: 'Instructor Uno' }),
      );
      expect(realtimeService.broadcast).toHaveBeenCalledWith(
        `user-${instructorId}-practice-slots`,
        'no-practice',
        expect.any(Object),
      );
    });

    it('consulta con los 3 estados que cuentan como "nadie va a estar ahí"', async () => {
      const { service, from } = buildHarness([EMPTY, EMPTY, EMPTY]);

      await service.runOnce();

      const closeChain = from.mock.results[1].value as ReturnType<typeof createChain>;
      expect(closeChain.in).toHaveBeenCalledWith('status', ['disponible', 'liberado', 'asignado']);
    });

    it('si el UPDATE no matchea ninguna fila (ya la tocó otra pasada), no notifica a nadie', async () => {
      const { service, emailService, realtimeService } = buildHarness([
        EMPTY,
        { data: [buildSlotRow({ status: 'asignado' })], error: null },
        { data: null, error: null }, // update no matchea
        EMPTY,
      ]);

      await service.runOnce();

      expect(emailService.sendNoPracticeEmail).not.toHaveBeenCalled();
      expect(realtimeService.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('completar franjas confirmadas vencidas', () => {
    it('marca completado solo las franjas cuya hora + duración ya pasó', async () => {
      const dueSlot = buildSlotRow({
        id: 'slot-due',
        status: 'confirmado',
        scheduled_at: new Date(Date.now() - 60 * 60_000).toISOString(), // hace 1 hora
        duration_minutes: 30, // 1h + 30min < ahora -> venció
      });
      const notDueSlot = buildSlotRow({
        id: 'slot-not-due',
        status: 'confirmado',
        scheduled_at: new Date(Date.now() + 60 * 60_000).toISOString(), // en 1 hora
        duration_minutes: 30,
      });

      const { service, from } = buildHarness([
        EMPTY,
        EMPTY,
        { data: [dueSlot, notDueSlot], error: null }, // select confirmado
        { data: null, error: null }, // update -> completado
      ]);

      await service.runOnce();

      const updateChain = from.mock.results[3].value as ReturnType<typeof createChain>;
      expect(updateChain.update).toHaveBeenCalledWith({ status: 'completado' });
      expect(updateChain.in).toHaveBeenCalledWith('id', ['slot-due']);
    });

    it('si ninguna franja venció, no ejecuta ningún UPDATE', async () => {
      const notDueSlot = buildSlotRow({
        status: 'confirmado',
        scheduled_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        duration_minutes: 30,
      });

      const { service, from } = buildHarness([EMPTY, EMPTY, { data: [notDueSlot], error: null }]);

      await service.runOnce();

      // Solo las 3 consultas SELECT de las 3 fases - ningún UPDATE extra.
      expect(from).toHaveBeenCalledTimes(3);
    });
  });
});
