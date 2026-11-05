import type { Modalidad } from './practiceSlotGeneration.model';
export interface StudentScheduleInput {
  fechaInicio: string;
  modalidad: Modalidad;
  horasPorDia: number;
}
export interface StudentScheduleSelection extends StudentScheduleInput {
  franjas: { fecha: string; hora: string }[];
}
export interface StudentScheduleReservation {
  id: string;
  enrollmentId: string;
  estado: 'vigente' | 'pago_en_curso' | 'liberada' | 'vencida' | 'confirmada';
  expiraAt: string;
  serverNow: string;
  extensiones: number;
  puedeAmpliar: boolean;
  cohorte: { id: string; nombre: string };
  franjas: { scheduledAt: string }[];
}
export interface StudentScheduleAvailability {
  enrollmentId: string;
  serverNow: string;
  horasRequeridas: number;
  dias: { fecha: string; horasASeleccionar: number; franjas: { hora: string; libre: boolean }[] }[];
  disponible: boolean;
  mensaje: string | null;
  fechasSugeridas: string[];
}
