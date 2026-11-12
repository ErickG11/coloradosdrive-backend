import { buildEnrollmentPlan } from '../utils/enrollmentRules';
import { cohortError } from '../config/cohortErrors';
import { DateTime } from 'luxon';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { StudentScheduleConfig } from '../config/studentScheduleConfig';
import type {
  StudentScheduleInput,
  StudentScheduleOptions,
  StudentSchedulePreview,
  StudentSchedulePreviewDay,
  StudentScheduleReservation,
  StudentScheduleSelection,
} from '../models/studentSchedule.model';
import { AppError } from '../utils/AppError';
import { SCHOOL_TIMEZONE } from '../utils/schoolTimezone';
import {
  buildFixedPlan,
  possibleStartHours,
  summarizeSlots,
  type FixedPlan,
} from '../utils/studentFixedPlan';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { expireStudentSchedule } from './studentScheduleExpiry.service';

type Db = SupabaseClient<Database>;
type CohortRow = Pick<
  Database['public']['Tables']['cohorts']['Row'],
  | 'id'
  | 'nombre'
  | 'fecha_inicio_curso'
  | 'fecha_fin_curso'
  | 'fecha_inicio_matricula'
  | 'fecha_fin_matricula'
  | 'cupo_maximo'
>;
const HOUR_MS = 3_600_000;
const NO_COHORT_MESSAGE =
  'No hay una cohorte con cupo que contenga todo el plan. Prueba un inicio posterior o consulta a la escuela.';
const dateError = (message: string): AppError =>
  new AppError(message, 400, { code: 'FECHA_INICIO_INVALIDA', field: 'fechaInicio' });

function firstPlan(plans: Map<number, FixedPlan>): FixedPlan {
  for (const plan of plans.values()) return plan;
  throw new AppError('No se pudo calcular el plan.', 400, { code: 'PLAN_INVALIDO' });
}
interface Evaluation {
  serverNow: string;
  required: number;
  plans: Map<number, FixedPlan>;
  cohort: { id: string; nombre: string } | null;
  sinCohorte: StudentScheduleOptions['sinCohorte'];
  free: Map<number, boolean>;
  own: number[];
}

export class StudentScheduleService {
  constructor(
    private readonly db: Db,
    private readonly config: StudentScheduleConfig,
  ) {}

  private async newRules(): Promise<boolean> {
    const flag = await this.db
      .from('enrollment_rule_flags')
      .select('enabled,implemented')
      .eq('key', 'reservations')
      .single();
    if (flag.error) throw cohortError('PLAN_CONFIG_NO_DISPONIBLE');
    return flag.data.enabled && flag.data.implemented;
  }
  private async previewNew(
    studentId: string,
    enrollmentId: string,
    input: StudentScheduleSelection,
  ): Promise<StudentSchedulePreview> {
    await this.expire(studentId);
    const plan = buildEnrollmentPlan(input);
    const result = await this.db.rpc('student_schedule_preview_v2', {
      p_student: studentId,
      p_enrollment: enrollmentId,
      p_input: {
        modalidad: input.modalidad,
        fechaInicio: input.fechaInicio,
        horasPorDia: input.horasPorDia,
        horaInicio: input.horaInicio,
      },
    });
    if (result.error) throwStudentScheduleError(result.error);
    const state = result.data;
    return {
      enrollmentId,
      serverNow: state.serverNow,
      modalidad: input.modalidad,
      precioCentavos: state.precioCentavos ?? undefined,
      horasTotales: 15,
      horasPorDia: plan.horasPorDia,
      horaInicio: plan.horaInicio,
      fechaInicioSolicitada: plan.fechaInicioSolicitada,
      fechaInicioEfectiva: plan.fechaInicioEfectiva,
      ajustada: plan.ajustada,
      ultimaFecha: plan.ultimaFecha,
      ultimaHoraFin: plan.ultimaHoraFin,
      ultimoFin: plan.ultimoFin,
      cohorte: null,
      sinCohorte: state.factible
        ? null
        : {
            codigo: 'SIN_COHORTE_ELEGIBLE',
            mensaje: 'No hay horarios disponibles para ese plan.',
            primeraFechaPosible: null,
          },
      diasFallan: state.diasFallan,
      factible: state.factible,
      dias: plan.dias.map((day) => ({
        ...day,
        disponible: !state.diasFallan.includes(day.fecha),
        motivo: state.diasFallan.includes(day.fecha)
          ? { codigo: 'DIA_SIN_INSTRUCTOR', mensaje: 'Sin disponibilidad en esta fecha.' }
          : null,
      })),
    };
  }

  private async context(
    studentId: string,
    enrollmentId: string,
  ): Promise<{ courseId: string; required: number }> {
    const { data, error } = await this.db
      .from('enrollments')
      .select('id,course_id,origen,etapa_inscripcion,status,requisitos_verificados_at')
      .eq('id', enrollmentId)
      .eq('student_id', studentId)
      .maybeSingle();
    if (error) throwStudentScheduleError(error);
    if (!data)
      throw new AppError('Matrícula no encontrada.', 404, { code: 'RESERVA_NO_ENCONTRADA' });
    if (
      data.origen !== 'solicitud' ||
      data.etapa_inscripcion !== 'por_agendar' ||
      data.status !== 'pendiente_cohorte' ||
      !data.requisitos_verificados_at
    )
      throw new AppError('La matrícula no está disponible para elegir un horario.', 403, {
        code: 'RESERVA_NO_PERMITIDA',
      });
    const course = await this.db
      .from('courses')
      .select('horas_requeridas')
      .eq('id', data.course_id)
      .single();
    if (course.error) throwStudentScheduleError(course.error);
    const required = course.data.horas_requeridas;
    if (required === null || !Number.isInteger(required) || required < 1 || required > 500)
      throw new AppError('La escuela debe configurar las horas del curso.', 409, {
        code: 'CURSO_SIN_HORAS',
      });
    return { courseId: data.course_id, required };
  }

  /** Mañana (Guayaquil) como mínimo y 365 días como máximo. */
  private startDate(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw dateError('Selecciona una fecha de inicio válida.');
    const date = DateTime.fromISO(value, { zone: SCHOOL_TIMEZONE });
    if (!date.isValid) throw dateError('Selecciona una fecha de inicio válida.');
    const today = DateTime.now().setZone(SCHOOL_TIMEZONE).startOf('day');
    if (date < today.plus({ days: 1 }))
      throw dateError('La fecha de inicio debe ser desde mañana.');
    if (date > today.plus({ days: 365 }))
      throw dateError('La fecha de inicio no puede superar un año.');
    return value;
  }

  private fits(cohort: CohortRow, first: string, last: string, today: string): boolean {
    return (
      cohort.fecha_inicio_matricula <= today &&
      today <= cohort.fecha_fin_matricula &&
      first >= cohort.fecha_inicio_curso &&
      last <=
        DateTime.fromISO(cohort.fecha_fin_curso, { zone: SCHOOL_TIMEZONE })
          .minus({ days: this.config.COHORT_MARGIN_DAYS })
          .toFormat('yyyy-LL-dd')
    );
  }

  /**
   * Un solo recorrido por la base: cohorte tentativa (misma regla que la RPC: primera
   * por inicio e id con cupo) y disponibilidad en lote de TODAS las franjas candidatas.
   */
  private async evaluate(
    studentId: string,
    enrollmentId: string,
    input: StudentScheduleInput,
    hours: number[],
  ): Promise<Evaluation> {
    await this.expire(studentId);
    const { courseId, required } = await this.context(studentId, enrollmentId);
    const start = this.startDate(input.fechaInicio);
    const plans = new Map<number, FixedPlan>();
    for (const hour of hours)
      plans.set(
        hour,
        buildFixedPlan({
          modalidad: input.modalidad,
          fechaInicio: start,
          horaInicio: hour,
          horasPorDia: input.horasPorDia,
          totalHoras: required,
        }),
      );
    const sample = firstPlan(plans);
    const today = DateTime.now().setZone(SCHOOL_TIMEZONE).toFormat('yyyy-LL-dd');
    const cohorts = await this.db
      .from('cohorts')
      .select(
        'id,nombre,fecha_inicio_curso,fecha_fin_curso,fecha_inicio_matricula,fecha_fin_matricula,cupo_maximo',
      )
      .eq('course_id', courseId)
      .lte('fecha_inicio_matricula', today)
      .gte('fecha_fin_matricula', today)
      .order('fecha_inicio_curso')
      .order('id');
    if (cohorts.error) throwStudentScheduleError(cohorts.error);
    const occupied = new Map<string, number>();
    if (cohorts.data.length) {
      const counts = await this.db.rpc('cohort_cupos_ocupados', {
        p_cohorts: cohorts.data.map((c) => c.id),
      });
      if (counts.error) throwStudentScheduleError(counts.error);
      for (const c of counts.data) occupied.set(c.cohort_id, c.ocupados);
    }
    const withRoom = cohorts.data.filter(
      (c) => occupied.has(c.id) && (occupied.get(c.id) ?? Infinity) < c.cupo_maximo,
    );
    const chosen = withRoom.find((c) =>
      this.fits(c, sample.dias[0].fecha, sample.ultimaFecha, today),
    );
    let sinCohorte: Evaluation['sinCohorte'] = null;
    if (!chosen) {
      // Primera fecha posible: orientativa, el alumno vuelve a consultar.
      let first: string | null = null;
      const tomorrow = DateTime.now()
        .setZone(SCHOOL_TIMEZONE)
        .startOf('day')
        .plus({ days: 1 })
        .toFormat('yyyy-LL-dd');
      for (const c of withRoom) {
        const from = c.fecha_inicio_curso > tomorrow ? c.fecha_inicio_curso : tomorrow;
        try {
          const alt = buildFixedPlan({
            modalidad: input.modalidad,
            fechaInicio: from,
            horaInicio: 6,
            horasPorDia: input.horasPorDia,
            totalHoras: required,
          });
          if (this.fits(c, alt.fechaInicioEfectiva, alt.ultimaFecha, today)) {
            first = alt.fechaInicioEfectiva;
            break;
          }
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
        }
      }
      sinCohorte = {
        codigo: 'SIN_COHORTE_ELEGIBLE',
        mensaje: NO_COHORT_MESSAGE,
        primeraFechaPosible: first,
      };
    }
    // Disponibilidad en lote: una consulta de franjas libres y una de prácticas propias.
    const slots = [...new Set([...plans.values()].flatMap((p) => p.franjas))];
    const free = new Map<number, boolean>();
    let own: number[] = [];
    if (slots.length) {
      const result = await this.db.rpc('student_schedule_free_slots', { p_slots: slots });
      if (result.error) throwStudentScheduleError(result.error);
      for (const slot of result.data) free.set(Date.parse(slot.scheduled_at), slot.libre);
      const times = slots.map((s) => Date.parse(s));
      const busy = await this.db
        .from('practice_slots')
        .select('scheduled_at')
        .eq('student_id', studentId)
        .in('status', ['asignado', 'confirmado', 'completado'])
        .gte('scheduled_at', new Date(Math.min(...times) - HOUR_MS).toISOString())
        .lte('scheduled_at', new Date(Math.max(...times) + HOUR_MS).toISOString());
      if (busy.error) throwStudentScheduleError(busy.error);
      own = busy.data.map((b) => Date.parse(b.scheduled_at));
    }
    return {
      serverNow: new Date().toISOString(),
      required,
      plans,
      cohort: chosen ? { id: chosen.id, nombre: chosen.nombre } : null,
      sinCohorte,
      free,
      own,
    };
  }

  private days(plan: FixedPlan, ev: Evaluation): StudentSchedulePreviewDay[] {
    return plan.dias.map((day) => {
      const times = day.franjas.map((s) => Date.parse(s));
      const overlap = times.some((t) => ev.own.some((o) => Math.abs(o - t) < HOUR_MS));
      const noInstructor = times.some((t) => ev.free.get(t) !== true);
      return {
        fecha: day.fecha,
        inicio: day.inicio,
        fin: day.fin,
        horaInicio: day.horaInicio,
        horaFin: day.horaFin,
        horas: day.horas,
        disponible: !overlap && !noInstructor,
        motivo: overlap
          ? { codigo: 'SOLAPE_PROPIO', mensaje: 'Ya tienes una práctica en ese horario.' }
          : noInstructor
            ? { codigo: 'DIA_SIN_INSTRUCTOR', mensaje: 'No hay instructor libre a esa hora.' }
            : null,
      };
    });
  }

  /** Horas de inicio posibles con su factibilidad (consulta en lote). */
  async options(
    studentId: string,
    enrollmentId: string,
    input: StudentScheduleInput,
  ): Promise<StudentScheduleOptions> {
    if (!Number.isInteger(input.horasPorDia) || input.horasPorDia < 1 || input.horasPorDia > 6)
      throw new AppError('Selecciona entre 1 y 6 horas por día.', 400, { code: 'PLAN_INVALIDO' });
    if (await this.newRules()) {
      const rows: StudentScheduleOptions['horas'] = [];
      let first: StudentSchedulePreview | null = null;
      // Secuencial y acotado: evita saturar la base al consultar todas las horas.
      for (const hour of possibleStartHours(input.horasPorDia)) {
        try {
          const p = await this.previewNew(studentId, enrollmentId, { ...input, horaInicio: hour });
          first ??= p;
          rows.push({
            hora: p.horaInicio,
            factible: p.factible,
            diasFallan: p.diasFallan,
            motivo: p.factible
              ? null
              : { codigo: 'DIA_SIN_INSTRUCTOR', mensaje: 'Sin disponibilidad para todo el plan.' },
          });
        } catch (error) {
          if (
            !(error instanceof AppError) ||
            !['PLAN_FRANJA_PASADA', 'PLAN_INICIO_PASADO'].includes(error.code ?? '')
          )
            throw error;
        }
      }
      const plan = buildEnrollmentPlan({ ...input, horaInicio: 6 });
      return {
        enrollmentId,
        serverNow: first?.serverNow ?? new Date().toISOString(),
        horasRequeridas: 15,
        fechaInicioEfectiva: plan.fechaInicioEfectiva,
        ajustada: plan.ajustada,
        cohorte: null,
        sinCohorte: rows.some((r) => r.factible)
          ? null
          : {
              codigo: 'SIN_COHORTE_ELEGIBLE',
              mensaje: 'No hay horarios disponibles.',
              primeraFechaPosible: null,
            },
        horas: rows,
      };
    }
    const ev = await this.evaluate(
      studentId,
      enrollmentId,
      input,
      possibleStartHours(input.horasPorDia),
    );
    const first = firstPlan(ev.plans);
    return {
      enrollmentId,
      serverNow: ev.serverNow,
      horasRequeridas: ev.required,
      fechaInicioEfectiva: first.fechaInicioEfectiva,
      ajustada: first.ajustada,
      cohorte: ev.cohort,
      sinCohorte: ev.sinCohorte,
      horas: [...ev.plans.entries()].map(([, plan]) => {
        const days = this.days(plan, ev);
        const failing = days.filter((d) => !d.disponible);
        if (!ev.cohort)
          return {
            hora: plan.horaInicio,
            factible: false,
            motivo: { codigo: 'SIN_COHORTE_ELEGIBLE' as const, mensaje: NO_COHORT_MESSAGE },
            diasFallan: failing.map((d) => d.fecha),
          };
        return {
          hora: plan.horaInicio,
          factible: failing.length === 0,
          motivo: failing.length
            ? {
                codigo: failing.every((d) => d.motivo?.codigo === 'SOLAPE_PROPIO')
                  ? ('SOLAPE_PROPIO' as const)
                  : ('DIA_SIN_INSTRUCTOR' as const),
                mensaje:
                  failing.length === 1
                    ? 'Falta disponibilidad en 1 día del plan.'
                    : `Falta disponibilidad en ${String(failing.length)} días del plan.`,
              }
            : null,
          diasFallan: failing.map((d) => d.fecha),
        };
      }),
    };
  }

  /** Vista previa de solo lectura del plan para una hora de inicio concreta. */
  async preview(
    studentId: string,
    enrollmentId: string,
    input: StudentScheduleSelection,
  ): Promise<StudentSchedulePreview> {
    if (await this.newRules()) return this.previewNew(studentId, enrollmentId, input);
    const ev = await this.evaluate(studentId, enrollmentId, input, [input.horaInicio]);
    const plan = firstPlan(ev.plans);
    const days = this.days(plan, ev);
    const failing = days.filter((d) => !d.disponible).map((d) => d.fecha);
    return {
      enrollmentId,
      serverNow: ev.serverNow,
      modalidad: input.modalidad,
      horasTotales: plan.totalHoras,
      horasPorDia: plan.horasPorDia,
      horaInicio: plan.horaInicio,
      fechaInicioSolicitada: plan.fechaInicioSolicitada,
      fechaInicioEfectiva: plan.fechaInicioEfectiva,
      ajustada: plan.ajustada,
      dias: days,
      ultimaFecha: plan.ultimaFecha,
      ultimaHoraFin: plan.ultimaHoraFin,
      ultimoFin: plan.ultimoFin,
      cohorte: ev.cohort,
      sinCohorte: ev.sinCohorte,
      diasFallan: failing,
      factible: !!ev.cohort && failing.length === 0,
    };
  }

  async reserve(
    studentId: string,
    enrollmentId: string,
    input: StudentScheduleSelection,
  ): Promise<StudentScheduleReservation> {
    if (await this.newRules()) {
      const plan = buildEnrollmentPlan(input);
      const result = await this.db.rpc('reserve_student_schedule', {
        p_student: studentId,
        p_enrollment: enrollmentId,
        p_slots: plan.franjas,
        p_modalidad: input.modalidad,
        p_inicio: input.fechaInicio,
        p_horas: input.horasPorDia,
        p_ttl: this.config.RESERVA_TTL_MINUTES,
        p_max_dia: this.config.RESERVA_MAX_POR_DIA,
        p_margen: this.config.COHORT_MARGIN_DAYS,
      });
      if (result.error) throwStudentScheduleError(result.error);
      return this.present(result.data);
    }
    // El servidor recalcula el plan completo; el cliente solo aporta cuatro datos.
    const ev = await this.evaluate(studentId, enrollmentId, input, [input.horaInicio]);
    const plan = firstPlan(ev.plans);
    if (!ev.cohort)
      throw new AppError(NO_COHORT_MESSAGE, 409, {
        code: 'SIN_COHORTE_ELEGIBLE',
        detalles: { primeraFechaPosible: ev.sinCohorte?.primeraFechaPosible ?? null },
      });
    const failing = this.days(plan, ev)
      .filter((d) => !d.disponible)
      .map((d) => d.fecha);
    if (failing.length)
      throw new AppError('Este horario no es factible: faltan instructores en algunos días.', 409, {
        code: 'PLAN_NO_FACTIBLE',
        detalles: { dias: failing },
      });
    // SQL vuelve a elegir cohorte por inicio, instructor POR FRANJA y cupo bajo locks.
    // El cliente nunca propone cohorte, instructor, franjas ni precio.
    const result = await this.db.rpc('reserve_student_schedule', {
      p_student: studentId,
      p_enrollment: enrollmentId,
      p_slots: plan.franjas,
      p_modalidad: input.modalidad,
      p_inicio: plan.fechaInicioEfectiva,
      p_horas: input.horasPorDia,
      p_ttl: this.config.RESERVA_TTL_MINUTES,
      p_max_dia: this.config.RESERVA_MAX_POR_DIA,
      p_margen: this.config.COHORT_MARGIN_DAYS,
    });
    if (result.error) throwStudentScheduleError(result.error);
    return this.present(result.data);
  }

  private present(reservation: StudentScheduleReservation): StudentScheduleReservation {
    return {
      ...reservation,
      plan: summarizeSlots(reservation.franjas.map((f) => f.scheduledAt)),
      puedeAmpliar:
        reservation.puedeAmpliar && reservation.extensiones < this.config.RESERVA_MAX_EXTENSIONES,
    };
  }

  async manage(
    studentId: string,
    action: 'actual' | 'ampliar' | 'liberar',
    id?: string,
  ): Promise<StudentScheduleReservation | null> {
    const result = await this.db.rpc('manage_student_reservation', {
      p_student: studentId,
      p_accion: action,
      ...(id ? { p_id: id } : {}),
      p_extension: this.config.RESERVA_EXTENSION_MINUTES,
      p_max_extensiones: this.config.RESERVA_MAX_EXTENSIONES,
      p_gracia: this.config.PAGO_GRACIA_MINUTES,
    });
    if (result.error) throwStudentScheduleError(result.error);
    return result.data ? this.present(result.data) : null;
  }

  async calendar(studentId: string, enrollmentId: string, input: StudentScheduleInput) {
    const result = await this.db.rpc('student_schedule_calendar_v2', {
      p_student: studentId,
      p_enrollment: enrollmentId,
      p_month: input.fechaInicio,
      p_mode: input.modalidad,
      p_hours: input.horasPorDia,
    });
    if (result.error) throwStudentScheduleError(result.error);
    return result.data;
  }
  async currentForEnrollment(studentId: string, enrollmentId: string) {
    const own = await this.db
      .from('enrollments')
      .select('id')
      .eq('student_id', studentId)
      .eq('id', enrollmentId)
      .maybeSingle();
    if (own.error) throwStudentScheduleError(own.error);
    if (!own.data) throw cohortError('RESERVA_MATRICULA_AJENA');
    await this.expire(studentId);
    const row = await this.db
      .from('student_schedule_reservations')
      .select('id')
      .eq('student_id', studentId)
      .eq('enrollment_id', enrollmentId)
      .order('creada_at', { ascending: false })
      .order('id')
      .limit(1)
      .maybeSingle();
    if (row.error) throwStudentScheduleError(row.error);
    return row.data ? this.manage(studentId, 'actual', row.data.id) : null;
  }
  async expire(studentId: string): Promise<number> {
    return expireStudentSchedule(this.db, studentId);
  }
}
