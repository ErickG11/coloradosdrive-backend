import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { StudentScheduleInput } from '../models/studentSchedule.model';
import { buildEnrollmentPlan } from '../utils/enrollmentRules';
import { configuredEnrollmentPlan } from './studentPlanRules.service';
import { planEndHour } from './planEndHour.service';

export type CalendarWithPlans<T extends { dias: { fecha: string }[] }> = T & {
  dias: { fecha: string; planDays: { fecha: string; horas: number }[] }[];
};

/** Calendario mensual de disponibilidad que devuelve la base. */
export interface ScheduleCalendar {
  serverNow: string;
  calendarEndDate?: string | null;
  dias: { fecha: string; disponible: boolean; motivo?: string | null }[];
}

/** Fechas del plan calculadas por el servidor, incluidas las que cruzan de mes. */
export async function calendarWithPlans<T extends { dias: { fecha: string }[] }>(
  db: SupabaseClient<Database>,
  input: StudentScheduleInput,
  calendar: T,
): Promise<CalendarWithPlans<T>> {
  const [base, endHour] = await Promise.all([
    configuredEnrollmentPlan(db, { ...input, horaInicio: 6 }),
    planEndHour(db),
  ]);
  return {
    ...calendar,
    dias: calendar.dias.map((day) => ({
      ...day,
      planDays: buildEnrollmentPlan(
        { ...input, fechaInicio: day.fecha, horaInicio: 6 },
        endHour,
        base.totalHoras,
      ).dias.map((d) => ({ fecha: d.fecha, horas: d.horas })),
    })),
  };
}
