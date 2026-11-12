export const NOTIFICATION_TYPES = [
  'recordatorio_practica',
  'espera_apertura',
  'plan_cambiado',
  'resultado_cancelacion',
  'cupo_disponible',
  'sin_practica_instructor',
  'cambio_realizado',
  'asistencia_corregida',
  'encuesta_practica',
  'documento_aprobado',
  'documento_rechazado',
  'contenido_habilitado',
  'examen_habilitado',
  'intento_extra',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationEmailStatus = 'pendiente' | 'enviado' | 'fallido' | null;

export interface NotificationRow extends Record<string, unknown> {
  domain_code?: string | null;
  domain_entity_id?: string | null;
  domain_severity?: string | null;
  domain_last_seen_at?: string | null;
  domain_resolved_at?: string | null;
  waitlist_type?: 'A' | 'B' | null;
  attendance_event_id: string | null;
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
  alert?: {
    code: string;
    entityId: string | null;
    severity: string;
    lastSeenAt: string | null;
    resolvedAt: string | null;
  };
  attendanceEventId: string | null;
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
