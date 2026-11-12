import type { ManualPracticeInput } from '../models/manualEnrollment.model';
import { buildEnrollmentPlan } from './enrollmentRules';
import { AppError } from './AppError';
import { isFechaCivil } from './cohortRules';
import { HORAS_POR_DIA_MESSAGE, isHorasPorDiaValid } from './practiceHours';
import { parseFechaCivil, parseHora, SCHOOL_TIMEZONE } from './schoolTimezone';

export const PRACTICE_MESSAGES = {
  fechaInicio: 'La fecha de inicio no es válida.',
  fechaFin: 'La fecha final no es válida.',
  fechaFinAnterior: 'La fecha final no puede ser anterior al inicio.',
  rangoSinDias: 'El rango elegido no contiene días de práctica de la modalidad seleccionada.',
  horaDeseada: 'La hora deseada debe estar entre 06:00 y 22:00.',
  horaNoCabe:
    'Con las horas por día elegidas, la práctica debe terminar a más tardar a las 22:00. Elige una hora más temprana o menos horas por día.',
} as const;

function invalid(message: string, field: string): AppError {
  return new AppError(message, 400, { code: 'INVALID_FIELD', field: `practice.${field}` });
}

// La interfaz consume este cálculo por HTTP; no hay una segunda fórmula en el navegador.
export interface ManualPracticePlan {
  rulesActive?: boolean;
  franjas?: string[];
  ultimaHoraFin?: string;
  precioCentavos?: number;
  timezone: string;
  semanas: number;
  modalidad: ManualPracticeInput['modalidad'];
  fechaInicio: string;
  primerDiaEfectivo: string;
  fechaFin: string;
  fechaFinElegida: string;
  manual: boolean;
  fechas: string[];
  dias: number;
  bloques: number;
  horas: number;
  horasPorDia: number;
  horaDeseada: string;
}
export function manualPracticePlan(input: ManualPracticeInput, exact = false): ManualPracticePlan {
  if (exact) {
    const hour = parseHora(input.horaResuelta ?? input.horaDeseada);
    if (hour.minute !== 0) throw invalid(PRACTICE_MESSAGES.horaDeseada, 'horaDeseada');
    const plan = buildEnrollmentPlan({
      modalidad: input.modalidad,
      fechaInicio: input.fechaInicio,
      horasPorDia: input.horasPorDia,
      horaInicio: hour.hour,
    });
    return {
      rulesActive: true,
      franjas: plan.franjas,
      ultimaHoraFin: plan.ultimaHoraFin,
      timezone: SCHOOL_TIMEZONE,
      semanas: input.semanas,
      modalidad: input.modalidad,
      fechaInicio: input.fechaInicio,
      primerDiaEfectivo: plan.fechaInicioEfectiva,
      fechaFin: plan.ultimaFecha,
      fechaFinElegida: plan.ultimaFecha,
      manual: false,
      fechas: plan.dias.map((d) => d.fecha),
      dias: plan.dias.length,
      bloques: 15,
      horas: 15,
      horasPorDia: input.horasPorDia,
      horaDeseada: input.horaDeseada,
    };
  }
  if (
    ![1, 2, 3].includes(input.semanas) ||
    !['entre_semana', 'fin_de_semana'].includes(input.modalidad)
  ) {
    throw new AppError('Duración o modalidad inválida', 400);
  }
  if (!isHorasPorDiaValid(input.horasPorDia)) throw invalid(HORAS_POR_DIA_MESSAGE, 'horasPorDia');
  const hora = parseHora(input.horaResuelta ?? input.horaDeseada);
  const minutos = hora.hour * 60 + hora.minute;
  if (minutos < 360 || minutos > 1320) throw invalid(PRACTICE_MESSAGES.horaDeseada, 'horaDeseada');
  if (minutos + input.horasPorDia * 60 > 1320)
    throw invalid(PRACTICE_MESSAGES.horaNoCabe, 'horaDeseada');
  if (!isFechaCivil(input.fechaInicio)) throw invalid(PRACTICE_MESSAGES.fechaInicio, 'fechaInicio');
  if (input.fechaFin !== undefined && !isFechaCivil(input.fechaFin))
    throw invalid(PRACTICE_MESSAGES.fechaFin, 'fechaFin');
  const start = parseFechaCivil(input.fechaInicio);
  const end = input.fechaFin === undefined ? null : parseFechaCivil(input.fechaFin);
  if (end && end < start) throw invalid(PRACTICE_MESSAGES.fechaFinAnterior, 'fechaFin');
  const diasObjetivo = input.semanas * (input.modalidad === 'entre_semana' ? 5 : 2);
  const fechas: string[] = [];
  let cursor = start;
  while (end ? cursor <= end : fechas.length < diasObjetivo) {
    const weekend = cursor.weekday >= 6;
    if (input.modalidad === 'entre_semana' ? !weekend : weekend)
      fechas.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }
  if (fechas.length === 0) throw invalid(PRACTICE_MESSAGES.rangoSinDias, 'fechaFin');
  return {
    timezone: SCHOOL_TIMEZONE,
    semanas: input.semanas,
    modalidad: input.modalidad,
    fechaInicio: input.fechaInicio,
    primerDiaEfectivo: fechas[0],
    fechaFin: fechas[fechas.length - 1],
    fechaFinElegida: input.fechaFin ?? fechas[fechas.length - 1],
    manual: end !== null,
    fechas,
    dias: fechas.length,
    bloques: fechas.length * input.horasPorDia,
    horas: fechas.length * input.horasPorDia,
    horasPorDia: input.horasPorDia,
    horaDeseada: input.horaDeseada,
  };
}
