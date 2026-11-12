import type { IndividualEnrollmentSnapshot } from './enrollmentFoundation.model';
import type { Modalidad } from './practiceSlotGeneration.model';
import type { ReservationPlanSummary } from '../utils/studentFixedPlan';

// I15: el alumno solo elige estos cuatro datos; el servidor calcula el plan.
export interface StudentScheduleInput {
  fechaInicio: string;
  modalidad: Modalidad;
  horasPorDia: number;
}
export interface StudentScheduleSelection extends StudentScheduleInput {
  horaInicio: number;
}
export interface StudentScheduleReservation {
  purpose?: 'initial' | 'plan_change';
  individualDates?: IndividualEnrollmentSnapshot;
  id: string;
  enrollmentId: string;
  estado: 'vigente' | 'pago_en_curso' | 'liberada' | 'vencida' | 'confirmada';
  expiraAt: string;
  serverNow: string;
  extensiones: number;
  puedeAmpliar: boolean;
  cohorte: { id: string; nombre: string };
  franjas: { scheduledAt: string }[];
  /** Derivado de las franjas retenidas; no se persiste. */
  plan?: ReservationPlanSummary | null;
}
export type StartHourReason = 'DIA_SIN_INSTRUCTOR' | 'SOLAPE_PROPIO' | 'SIN_COHORTE_ELEGIBLE';
export interface StudentScheduleStartOption {
  hora: string;
  factible: boolean;
  motivo: { codigo: StartHourReason; mensaje: string } | null;
  diasFallan: string[];
}
export interface StudentScheduleOptions {
  enrollmentId: string;
  serverNow: string;
  horasRequeridas: number;
  fechaInicioEfectiva: string;
  ajustada: boolean;
  cohorte: { id: string; nombre: string } | null;
  sinCohorte: {
    codigo: 'SIN_COHORTE_ELEGIBLE';
    mensaje: string;
    primeraFechaPosible: string | null;
  } | null;
  horas: StudentScheduleStartOption[];
}
export interface StudentSchedulePreviewDay {
  fecha: string;
  inicio: string;
  fin: string;
  horaInicio: string;
  horaFin: string;
  horas: number;
  disponible: boolean;
  motivo: { codigo: 'DIA_SIN_INSTRUCTOR' | 'SOLAPE_PROPIO'; mensaje: string } | null;
}
export interface StudentSchedulePreview {
  precioCentavos?: number;
  enrollmentId: string;
  serverNow: string;
  modalidad: Modalidad;
  horasTotales: number;
  horasPorDia: number;
  horaInicio: string;
  fechaInicioSolicitada: string;
  fechaInicioEfectiva: string;
  ajustada: boolean;
  dias: StudentSchedulePreviewDay[];
  ultimaFecha: string;
  ultimaHoraFin: string;
  ultimoFin: string;
  cohorte: { id: string; nombre: string } | null;
  sinCohorte: StudentScheduleOptions['sinCohorte'];
  diasFallan: string[];
  factible: boolean;
}

export interface StudentPlanRules {
  active: boolean;
  serverNow: string;
  options: {
    modalidad: 'entre_semana' | 'fin_de_semana';
    horasPorDia: number;
    habilitada: boolean;
    sesiones: number;
    primeraFecha: string;
    ultimaFecha: string;
  }[];
}
