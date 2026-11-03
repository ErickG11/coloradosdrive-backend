export interface EnrollmentBudget {
  usado: number;
  tope: number;
  alerta: boolean;
}
export interface EnrollmentSummary {
  pendientes: number;
  devueltas: number;
  conMasDe48h: number;
  inscripcionesAbiertas: boolean;
  cupoCodigosHoy: EnrollmentBudget;
  cupoSubidasHoy: EnrollmentBudget;
  cupoSolicitudesHoy: EnrollmentBudget;
  alertas: ('codigos' | 'subidas' | 'solicitudes')[];
}
export interface EnrollmentSummaryRow {
  pendientes: number;
  devueltas: number;
  conMasDe48h: number;
  inscripcionesAbiertas: boolean;
  contadoresHoy: Partial<Record<'codigos' | 'subidas' | 'solicitudes', number>>;
}
export interface EnrollmentReservation {
  permitido: boolean;
  motivo?: 'cerradas' | 'limite';
}
export interface EnrollmentDraftReservation {
  id?: string;
  creada?: boolean;
  permitido?: boolean;
  motivo?: 'cerradas' | 'limite';
}
