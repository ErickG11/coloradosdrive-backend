import { DateTime } from 'luxon';
import { cohortError } from '../config/cohortErrors';
import { buildFixedPlan, type FixedPlan, type FixedPlanInput } from './studentFixedPlan';
import { parseFechaCivil, SCHOOL_TIMEZONE } from './schoolTimezone';

export interface CohortCalendarInput {
  enrollmentStart: string; enrollmentEnd: string; practiceStart: string; practiceEnd: string; enabled: boolean;
}
export function buildEnrollmentPlan(input: Omit<FixedPlanInput, 'totalHoras'>): FixedPlan {
  try { return buildFixedPlan({ ...input, totalHoras: 15 }); }
  catch { throw cohortError('PLAN_ENTRADA_INVALIDA'); }
}
export function assertFuturePlan(plan: FixedPlan, now: Date): void {
  const today = DateTime.fromJSDate(now, { zone: SCHOOL_TIMEZONE }).toISODate();
  if (!today || plan.fechaInicioEfectiva < today) throw cohortError('PLAN_INICIO_PASADO');
  if (plan.franjas.some((slot) => Date.parse(slot) <= now.getTime())) throw cohortError('PLAN_FRANJA_PASADA');
}
export function cohortCalendar(input: CohortCalendarInput, now: Date) {
  let dates: DateTime[];
  try { dates = [input.enrollmentStart,input.enrollmentEnd,input.practiceStart,input.practiceEnd].map(parseFechaCivil); }
  catch { throw cohortError('COHORTE_FECHAS_INVALIDAS'); }
  const [start,end,practiceStart,practiceEnd] = dates;
  if (start > end || end > practiceEnd || practiceStart > practiceEnd) throw cohortError('COHORTE_FECHAS_INVALIDAS');
  const cutoff = end.minus({ days: 5 });
  const exclusive = cutoff.plus({ days: 1 }).toUTC();
  const current = DateTime.fromJSDate(now, { zone: SCHOOL_TIMEZONE });
  const finished = current >= practiceEnd.plus({ days: 1 });
  const open = !finished && input.enabled && current >= start && current < exclusive;
  return { cutoff: cutoff.toISODate()!, cutoffExclusive: exclusive.toISO()!, open, finished,
    state: finished ? 'terminada' as const : open ? 'matricula_abierta' as const : 'matricula_cerrada_en_curso' as const };
}
