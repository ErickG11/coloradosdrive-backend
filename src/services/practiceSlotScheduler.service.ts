import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { EmailService } from './email.service';
import type { RealtimeService } from './realtime.service';

type PracticeSlotRow = Database['public']['Tables']['practice_slots']['Row'];

const CONFIRMATION_REMINDER_MINUTES_BEFORE = 20;
const CONFIRMATION_WINDOW_CLOSE_MINUTES = 5;

// Recibe el cliente de Supabase, EmailService y RealtimeService por
// constructor (mismo patrón que el resto de servicios) para poder
// mockearlos en tests con el tiempo controlado, en vez de esperar
// minutos reales. src/jobs/practiceSlotCron.ts es el único que
// instancia esta clase con los singletons reales y la conecta a
// node-cron - correr cada minuto es responsabilidad de ese archivo, no
// de esta clase, que solo sabe "ejecutar una pasada ahora mismo".
export class PracticeSlotSchedulerService {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly emailService: EmailService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async runOnce(): Promise<void> {
    await this.notifyUpcomingConfirmations();
    await this.closeSlotsWithoutPractice();
    await this.completeFinishedSlots();
  }

  // RF-03: notifica 20 minutos antes de la práctica, pidiendo
  // confirmación. Solo franjas 'asignado' nunca notificadas todavía, y
  // que todavía no hayan empezado (evita reenviar un recordatorio
  // engañoso si el proceso estuvo caído y esta pasada se ejecuta tarde).
  private async notifyUpcomingConfirmations(): Promise<void> {
    const now = new Date();
    const reminderThreshold = new Date(
      now.getTime() + CONFIRMATION_REMINDER_MINUTES_BEFORE * 60_000,
    );

    const { data, error } = await this.supabase
      .from('practice_slots')
      .select()
      .eq('status', 'asignado')
      .is('confirmation_notified_at', null)
      .lte('scheduled_at', reminderThreshold.toISOString())
      .gt('scheduled_at', now.toISOString());

    if (error) {
      throw error;
    }

    for (const row of data) {
      await this.processConfirmationReminder(row);
    }
  }

  private async processConfirmationReminder(row: PracticeSlotRow): Promise<void> {
    if (row.student_id) {
      await this.notifyStudentConfirmationRequestSafely(row.student_id, row.scheduled_at);
    }

    const { error } = await this.supabase
      .from('practice_slots')
      .update({ confirmation_notified_at: new Date().toISOString() })
      .eq('id', row.id);

    if (error) {
      throw error;
    }
  }

  // RF-03: "la asignación del cupo liberado es por orden de solicitud;
  // ... si ningún estudiante toma el cupo faltando 5 minutos ... el
  // sistema notifica al instructor". Se trata igual una franja jamás
  // reclamada (disponible), una liberada sin volver a tomarse
  // (liberado), y una asignada que nunca se confirmó (asignado) - las
  // 3 significan "nadie va a estar ahí", sin margen real para que
  // alguien más la tome a esta altura.
  private async closeSlotsWithoutPractice(): Promise<void> {
    const closeThreshold = new Date(Date.now() + CONFIRMATION_WINDOW_CLOSE_MINUTES * 60_000);

    const { data, error } = await this.supabase
      .from('practice_slots')
      .select()
      .in('status', ['disponible', 'liberado', 'asignado'])
      .lte('scheduled_at', closeThreshold.toISOString());

    if (error) {
      throw error;
    }

    for (const row of data) {
      await this.closeSlotWithoutPracticeSafely(row);
    }
  }

  private async closeSlotWithoutPracticeSafely(row: PracticeSlotRow): Promise<void> {
    // El UPDATE repite la condición de estado: si otra pasada, u otra
    // acción del estudiante (ej. justo reclamó/confirmó), ya cambió esta
    // fila entre el SELECT y este punto, no la pisamos por error.
    const { data, error } = await this.supabase
      .from('practice_slots')
      .update({
        status: 'sin_practica',
        student_id: null,
        confirmed_at: null,
        confirmation_notified_at: null,
      })
      .eq('id', row.id)
      .in('status', ['disponible', 'liberado', 'asignado'])
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return;
    }

    // row.student_id (antes del UPDATE, que ya lo limpió a NULL) es
    // no-nulo únicamente si la franja venía de 'asignado' - el estudiante
    // que la tenía asignada también debe enterarse de que perdió el cupo
    // por no confirmar a tiempo, no solo el instructor.
    if (row.student_id) {
      await this.broadcastToUserSafely(row.student_id, 'no-practice', {
        scheduledAt: data.scheduled_at,
      });
    }

    await this.notifyInstructorNoPracticeSafely(data.instructor_id, data.scheduled_at);
  }

  // RF-03: al pasar scheduled_at + duration_minutes, un turno confirmado
  // se da por completado. No hay notificación asociada a esta
  // transición (el documento no la pide).
  private async completeFinishedSlots(): Promise<void> {
    const { data, error } = await this.supabase
      .from('practice_slots')
      .select()
      .eq('status', 'confirmado');

    if (error) {
      throw error;
    }

    const now = Date.now();
    const dueIds = data
      .filter((row) => new Date(row.scheduled_at).getTime() + row.duration_minutes * 60_000 <= now)
      .map((row) => row.id);

    if (dueIds.length === 0) {
      return;
    }

    const { error: updateError } = await this.supabase
      .from('practice_slots')
      .update({ status: 'completado' })
      .in('id', dueIds);

    if (updateError) {
      throw updateError;
    }
  }

  private async notifyStudentConfirmationRequestSafely(
    studentId: string,
    scheduledAt: string,
  ): Promise<void> {
    try {
      const { nombreCompleto, email } = await this.getUserContact(studentId);
      await this.emailService.sendPracticeConfirmationRequestEmail({
        to: email,
        nombreCompleto,
        scheduledAt,
      });
    } catch (err) {
      console.error('No se pudo enviar el correo de confirmación de práctica:', err);
    }

    await this.broadcastToUserSafely(studentId, 'confirmation-requested', { scheduledAt });
  }

  private async notifyInstructorNoPracticeSafely(
    instructorId: string,
    scheduledAt: string,
  ): Promise<void> {
    try {
      const { nombreCompleto, email } = await this.getUserContact(instructorId);
      await this.emailService.sendNoPracticeEmail({ to: email, nombreCompleto, scheduledAt });
    } catch (err) {
      console.error('No se pudo enviar el correo de sin-práctica al instructor:', err);
    }

    await this.broadcastToUserSafely(instructorId, 'no-practice', { scheduledAt });
  }

  private async broadcastToUserSafely(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.realtimeService.broadcast(`user-${userId}-practice-slots`, event, payload);
    } catch (err) {
      console.error(`No se pudo notificar (Realtime) el evento "${event}":`, err);
    }
  }

  private async getUserContact(userId: string): Promise<{ nombreCompleto: string; email: string }> {
    const { data: userRow, error: userError } = await this.supabase
      .from('users')
      .select('nombre_completo')
      .eq('id', userId)
      .maybeSingle();
    if (userError) {
      throw userError;
    }
    if (!userRow) {
      throw new Error('Usuario no encontrado');
    }

    const { data: authUser, error: authError } = await this.supabase.auth.admin.getUserById(userId);
    if (authError) {
      throw authError;
    }
    if (!authUser.user.email) {
      throw new Error('Correo del usuario no disponible');
    }

    return { nombreCompleto: userRow.nombre_completo, email: authUser.user.email };
  }
}
