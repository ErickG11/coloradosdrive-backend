import { DateTime } from 'luxon';
import type { Modalidad } from '../models/practiceSlotGeneration.model';
import { AppError } from './AppError';
import { SCHOOL_TIMEZONE, parseFechaCivil, toScheduledAtUTC } from './schoolTimezone';

// I15: HORA FIJA Y PLAN AUTOMÁTICO. El alumno solo elige modalidad, fecha de inicio,
// horas por día y hora de inicio; esta función pura construye el resto. No consulta
// base de datos ni reloj, así que es determinista y reutilizable. Limitación conocida:
// no se consideran feriados.
export const PLAN_FIRST_HOUR = 6;
export const PLAN_END_LIMIT_HOUR = 22;

export interface FixedPlanInput {
  modalidad: Modalidad;
  fechaInicio: string;
  horaInicio: number;
  horasPorDia: number;
  totalHoras: number;
}
export interface FixedPlanDay {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  horas: number;
  /** Instante local con desfase (America/Guayaquil). */
  inicio: string;
  fin: string;
  /** Bloques de 1 hora, instantes UTC. */
  franjas: string[];
}
export interface FixedPlan {
  fechaInicioSolicitada: string;
  fechaInicioEfectiva: string;
  ajustada: boolean;
  horaInicio: string;
  horasPorDia: number;
  totalHoras: number;
  dias: FixedPlanDay[];
  franjas: string[];
  ultimaFecha: string;
  ultimaHoraFin: string;
  ultimoFin: string;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
function isModalityDay(date: DateTime, modalidad: Modalidad): boolean {
  const weekend = date.weekday === 6 || date.weekday === 7;
  return modalidad === 'fin_de_semana' ? weekend : !weekend;
}
function invalidHour(endHour: number): AppError {
  return new AppError(
    `Elige una hora de inicio entera desde las 06:00 que permita terminar a más tardar a las ${hourLabel(endHour)}.`,
    400,
    { code: 'HORA_INICIO_INVALIDA', field: 'horaInicio' },
  );
}

/** Horas de inicio posibles para N horas por día: de las 06 a las (tope configurado − N). */
export function possibleStartHours(horasPorDia: number, endHour = PLAN_END_LIMIT_HOUR): number[] {
  const last = Math.min(23, endHour - horasPorDia);
  return Array.from(
    { length: Math.max(0, last - PLAN_FIRST_HOUR + 1) },
    (_, i) => PLAN_FIRST_HOUR + i,
  );
}

export function buildFixedPlan(input: FixedPlanInput, endHour = PLAN_END_LIMIT_HOUR): FixedPlan {
  const { modalidad, horaInicio, horasPorDia, totalHoras } = input;
  if (!['entre_semana', 'fin_de_semana'].includes(modalidad))
    throw new AppError('Selecciona la modalidad.', 400, { code: 'PLAN_INVALIDO' });
  if (!Number.isInteger(horasPorDia) || horasPorDia < 1 || horasPorDia > 6)
    throw new AppError('Selecciona entre 1 y 6 horas por día.', 400, { code: 'PLAN_INVALIDO' });
  if (!Number.isInteger(totalHoras) || totalHoras < 1 || totalHoras > 500)
    throw new AppError('Las horas del curso no son válidas.', 400, { code: 'PLAN_INVALIDO' });
  if (
    !Number.isInteger(horaInicio) ||
    horaInicio < PLAN_FIRST_HOUR ||
    horaInicio > Math.min(23, endHour - 1) ||
    horaInicio + horasPorDia > endHour
  )
    throw invalidHour(endHour);
  const requested = parseFechaCivil(input.fechaInicio);
  const days: FixedPlanDay[] = [];
  let remaining = totalHoras;
  let cursor = requested;
  const limit = requested.plus({ years: 3 });
  while (remaining > 0) {
    if (cursor > limit)
      throw new AppError('No se pudo calcular el plan.', 400, { code: 'PLAN_INVALIDO' });
    if (isModalityDay(cursor, modalidad)) {
      const hours = Math.min(horasPorDia, remaining);
      const slots = Array.from({ length: hours }, (_, i) =>
        toScheduledAtUTC(cursor, { hour: horaInicio + i, minute: 0 }),
      );
      const start = cursor.set({ hour: horaInicio, minute: 0, second: 0, millisecond: 0 });
      const end = start.plus({ hours });
      days.push({
        fecha: cursor.toFormat('yyyy-LL-dd'),
        horaInicio: hourLabel(horaInicio),
        horaFin: hourLabel(horaInicio + hours),
        horas: hours,
        inicio: start.toISO({ suppressMilliseconds: true }) ?? '',
        fin: end.toISO({ suppressMilliseconds: true }) ?? '',
        franjas: slots,
      });
      remaining -= hours;
    }
    cursor = cursor.plus({ days: 1 });
  }
  const last = days[days.length - 1];
  return {
    fechaInicioSolicitada: input.fechaInicio,
    fechaInicioEfectiva: days[0].fecha,
    ajustada: days[0].fecha !== input.fechaInicio,
    horaInicio: hourLabel(horaInicio),
    horasPorDia,
    totalHoras,
    dias: days,
    franjas: days.flatMap((d) => d.franjas),
    ultimaFecha: last.fecha,
    ultimaHoraFin: last.horaFin,
    ultimoFin: last.fin,
  };
}

export interface ReservationPlanSummary {
  horaInicio: string;
  horasPorDia: number;
  totalHoras: number;
  dias: { fecha: string; horaInicio: string; horaFin: string; horas: number }[];
  ultimaFecha: string;
  ultimaHoraFin: string;
}
/** Deriva el plan desde las franjas retenidas (sin cambiar el modelo de datos). */
export function summarizeSlots(scheduledAt: string[]): ReservationPlanSummary | null {
  const local = scheduledAt
    .map((s) => DateTime.fromISO(s, { zone: SCHOOL_TIMEZONE }))
    .filter((d) => d.isValid)
    .sort((a, b) => a.toMillis() - b.toMillis());
  if (!local.length) return null;
  const byDay = new Map<string, DateTime[]>();
  for (const slot of local) {
    const key = slot.toFormat('yyyy-LL-dd');
    byDay.set(key, [...(byDay.get(key) ?? []), slot]);
  }
  const dias = [...byDay.entries()].map(([fecha, slots]) => ({
    fecha,
    horaInicio: hourLabel(slots[0].hour),
    horaFin: hourLabel(slots[slots.length - 1].hour + 1),
    horas: slots.length,
  }));
  const last = dias[dias.length - 1];
  return {
    horaInicio: dias[0].horaInicio,
    horasPorDia: Math.max(...dias.map((d) => d.horas)),
    totalHoras: local.length,
    dias,
    ultimaFecha: last.fecha,
    ultimaHoraFin: last.horaFin,
  };
}
