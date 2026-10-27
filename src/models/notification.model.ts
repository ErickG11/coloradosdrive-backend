export const NOTIFICATION_TYPES = [
  'recordatorio_practica', 'resultado_cancelacion', 'cupo_disponible',
  'sin_practica_instructor', 'cambio_realizado',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationEmailStatus = 'pendiente' | 'enviado' | 'fallido' | null;

export interface NotificationRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  practice_slot_id: string | null;
  scheduled_at: string | null;
  created_at: string;
  read_at: string | null;
  email_status: NotificationEmailStatus;
  email_attempts: number;
  email_last_error: string | null;
  email_next_attempt_at: string;
  email_lease_token: string | null;
  email_locked_until: string | null;
}

export interface Notification {
  id: string;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  practiceSlotId: string | null;
  scheduledAt: string | null;
  createdAt: string;
  readAt: string | null;
  emailStatus: NotificationEmailStatus;
  emailAttempts: number;
}

export interface NotificationsPage {
  items: Notification[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
}
