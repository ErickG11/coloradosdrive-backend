import type { FixedPlan, FixedPlanInput } from '../utils/studentFixedPlan';
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
  const options = await db
    .from('enrollment_plan_options')
    .select('*')
    .order('modalidad')
    .order('horas_por_dia');
  if (options.error) throw cohortError('PLAN_CONFIG_NO_DISPONIBLE');
  const endHour = await planEndHour(db);
  const today = DateTime.fromJSDate(now, { zone: SCHOOL_TIMEZONE }).toISODate();
  if (!today) throw cohortError('PLAN_CONFIG_NO_DISPONIBLE');
  return {
    active: flags.data.enabled && flags.data.implemented,
    endHour,
    serverNow: now.toISOString(),
    options: options.data
      .filter((o) => o.habilitada)
      .map((o) => {
        const plan = buildEnrollmentPlan(
          {
            modalidad: o.modalidad,
            horasPorDia: o.horas_por_dia,
            horaInicio: 6,
            fechaInicio: today,
          },
          endHour,
          o.horas_objetivo,
        );
        return {
          modalidad: o.modalidad,
          horasPorDia: o.horas_por_dia,
          habilitada: o.habilitada,
          sesiones: plan.dias.length,
          totalHoras: o.horas_objetivo,
          primeraFecha: plan.fechaInicioEfectiva,
          ultimaFecha: plan.ultimaFecha,
        };
      }),
  };
}

/** La oferta habilitada es la única fuente del objetivo de un plan nuevo. */
export async function configuredEnrollmentPlan(
  db: SupabaseClient<Database>,
  input: Omit<FixedPlanInput, 'totalHoras'>,
): Promise<FixedPlan> {
  const option = await db
    .from('enrollment_plan_options')
    .select('*')
    .eq('modalidad', input.modalidad)
    .eq('horas_por_dia', input.horasPorDia)
    .eq('habilitada', true)
    .maybeSingle();
  if (option.error) throw cohortError('PLAN_CONFIG_NO_DISPONIBLE');
  if (!option.data?.habilitada) throw cohortError('PLAN_ENTRADA_INVALIDA');
  return buildEnrollmentPlan(input, await planEndHour(db), option.data.horas_objetivo);
}
