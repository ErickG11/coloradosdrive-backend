import { planEndHour } from './planEndHour.service';
import { DateTime } from 'luxon';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { cohortError } from '../config/cohortErrors';
import { buildEnrollmentPlan } from '../utils/enrollmentRules';
import { SCHOOL_TIMEZONE } from '../utils/schoolTimezone';
import type { StudentPlanRules } from '../models/studentSchedule.model';
export async function studentPlanRules(db: SupabaseClient<Database>): Promise<StudentPlanRules> {
  const now = new Date();
  const flags = await db
    .from('enrollment_rule_flags')
    .select('enabled,implemented')
    .eq('key', 'date_rules')
    .single();
  if (flags.error) throw cohortError('PLAN_CONFIG_NO_DISPONIBLE');
  if (!flags.data.enabled || !flags.data.implemented)
    return { active: false, serverNow: now.toISOString(), options: [] };
  const options = await db
    .from('enrollment_plan_options')
    .select('*')
    .order('modalidad')
    .order('horas_por_dia');
  if (options.error) throw cohortError('PLAN_CONFIG_NO_DISPONIBLE');
  const endHour = await planEndHour(db);
  const today = DateTime.fromJSDate(now, { zone: SCHOOL_TIMEZONE }).toISODate()!;
  return {
    active: true,
    endHour,
    serverNow: now.toISOString(),
    options: options.data.map((o) => {
      const plan = buildEnrollmentPlan(
        { modalidad: o.modalidad, horasPorDia: o.horas_por_dia, horaInicio: 6, fechaInicio: today },
        endHour,
      );
      return {
        modalidad: o.modalidad,
        horasPorDia: o.horas_por_dia,
        habilitada: o.habilitada,
        sesiones: plan.dias.length,
        primeraFecha: plan.fechaInicioEfectiva,
        ultimaFecha: plan.ultimaFecha,
      };
    }),
  };
}
