import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { Notification, NotificationRow, NotificationsPage } from '../models/notification.model';
import { AppError } from '../utils/AppError';
import { throwPracticeWriteError } from '../utils/practiceSlotIntegrity';

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id, tipo: row.tipo, titulo: row.titulo, mensaje: row.mensaje,
    attendanceEventId: row.attendance_event_id ?? null,
    practiceSlotId: row.practice_slot_id, scheduledAt: row.scheduled_at,
    createdAt: row.created_at, readAt: row.read_at,
    emailStatus: row.email_status, emailAttempts: row.email_attempts,
  };
}

export class NotificationService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async list(userId: string, page: number, pageSize: number): Promise<NotificationsPage> {
    const { data, error } = await this.supabase.rpc('list_user_notifications', {
      p_user: userId, p_page: page, p_page_size: pageSize,
    });
    if (error) throwPracticeWriteError(error);
    return { ...data, items: data.items.map(toNotification), page, pageSize };
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const { data, error } = await this.supabase.rpc('mark_user_notification_read', {
      p_user: userId, p_id: id,
    }).maybeSingle();
    if (error) throwPracticeWriteError(error);
    if (!data) throw new AppError('Notificación no encontrada', 404);
    return toNotification(data);
  }

  async readAll(userId: string): Promise<{ updatedCount: number }> {
    const { data, error } = await this.supabase.rpc('read_all_user_notifications', { p_user: userId });
    if (error) throwPracticeWriteError(error);
    return { updatedCount: data };
  }
}
