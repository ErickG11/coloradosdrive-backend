/** Lote 1: contratos aditivos. Ningún endpoint ni guard consume todavía estos campos. */
export type EnrollmentRuleKey =
  | 'prices'
  | 'date_rules'
  | 'capacity'
  | 'reservations'
  | 'payments'
  | 'cohort_admin'
  | 'enrollment_access'
  | 'waitlist'
  | 'schedule_changes'
  | 'billing'
  | 'identity'
  | 'foreign_identity'
  | 'permissions'
  | 'metrics';
export type EnrollmentPermission =
  'verify_identity' | 'manage_cohorts_prices' | 'reassign_schedules' | 'view_payments_invoices';
export type IndividualDatesSource =
  'practice_plan' | 'reservation_holds' | 'practice_slots' | 'approved_exception';
export interface EnrollmentFoundationColumns {
  practice_start_date: string | null;
  practice_end_date: string | null;
  access_end_date: string | null;
  paid_amount_centavos: number | null;
  individual_dates_source: IndividualDatesSource | null;
  individual_dates_guard_ready: boolean;
}
export interface ReservationFoundationColumns {
  precio_snapshot_centavos: number | null;
  precio_snapshot_source: 'payment_snapshot' | 'reservation_creation' | null;
  precio_snapshot_at: string | null;
  practice_start_date: string | null;
  practice_end_date: string | null;
  admission_at: string | null;
  admission_rule_version: string | null;
}
export interface CohortFoundationColumns {
  codigo: string | null;
  habilitada: boolean;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
}
/** Transporte futuro separado de la cohorte. Fecha civil ISO, importes en centavos USD. */
export interface IndividualEnrollmentSnapshot {
  practiceStartDate: string | null;
  practiceEndDate: string | null;
  accessEndDate: string | null;
  paidAmountCentavos: number | null;
  datesSource: IndividualDatesSource | null;
  guardReady: boolean;
}
export interface EnrollmentRuleFlagRow {
  key: EnrollmentRuleKey;
  enabled: boolean;
  implemented: boolean;
  updated_by: string | null;
  reason: string;
  updated_at: string;
}
export interface CourseTypePriceRow {
  tipo: 'A' | 'B';
  precio_centavos: number;
  moneda: 'USD';
  updated_by: string;
  motivo: string;
  updated_at: string;
}
export interface EnrollmentPlanOptionRow {
  modalidad: 'entre_semana' | 'fin_de_semana';
  horas_por_dia: number;
  habilitada: boolean;
  horas_objetivo: 15;
  motivo: string;
}
export interface EnrollmentPermissionRow {
  admin_id: string;
  permission: EnrollmentPermission;
  granted_by: string;
  reason: string;
  granted_at: string;
  revoked_at: string | null;
}
export interface EnrollmentAuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string;
  occurred_at: string;
}
export interface EnrollmentFunnelRow {
  id: string;
  enrollment_id: string | null;
  event: 'registered' | 'verified' | 'schedule_chosen' | 'reserved' | 'paid' | 'expired';
  dedup_key: string;
  occurred_at: string;
}
export type FoundationFields<Row> = { [K in keyof Row]: Row[K] };
export interface FoundationReadOnlyTable<Row> {
  Row: FoundationFields<Row>;
  Insert: never;
  Update: never;
  Relationships: [];
}
