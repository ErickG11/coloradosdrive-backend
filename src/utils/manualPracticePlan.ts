import type { ManualPracticeInput } from '../models/manualEnrollment.model';
import { AppError } from './AppError';
import { parseFechaCivil, parseHora, SCHOOL_TIMEZONE } from './schoolTimezone';

// La interfaz consume este cálculo por HTTP; no hay una segunda fórmula en el navegador.
export interface ManualPracticePlan {
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
export function manualPracticePlan(input: ManualPracticeInput): ManualPracticePlan {
  if (
    ![1, 2, 3].includes(input.semanas) ||
    !['entre_semana', 'fin_de_semana'].includes(input.modalidad)
  ) {
    throw new AppError('Duración o modalidad inválida', 400);
  }
  if (!Number.isInteger(input.horasPorDia) || input.horasPorDia < 1 || input.horasPorDia > 16) {
    throw new AppError('Horas por día debe ser un entero entre 1 y 16', 400);
  }
  const hora = parseHora(input.horaResuelta ?? input.horaDeseada);
  if (
    hora.hour * 60 + hora.minute < 360 ||
    (hora.hour + input.horasPorDia) * 60 + hora.minute > 1320
  ) {
    throw new AppError('El horario debe caber dentro de 06:00–22:00', 400);
  }
  const start = parseFechaCivil(input.fechaInicio);
  const end = input.fechaFin === undefined ? null : parseFechaCivil(input.fechaFin);
  if (end && end < start) {
    throw new AppError('La fecha final no puede ser anterior al inicio', 400);
  }
  const diasObjetivo = input.semanas * (input.modalidad === 'entre_semana' ? 5 : 2);
  const fechas: string[] = [];
  let cursor = start;
  while (end ? cursor <= end : fechas.length < diasObjetivo) {
    const weekend = cursor.weekday >= 6;
    if (input.modalidad === 'entre_semana' ? !weekend : weekend)
      fechas.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }
  if (fechas.length === 0)
    throw new AppError('El rango no contiene días aplicables a la modalidad', 400);
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
