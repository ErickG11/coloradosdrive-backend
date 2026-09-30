import type { SupabaseClient } from '@supabase/supabase-js';
import type { DateTime } from 'luxon';

import type { Database } from '../config/database.types';
import type {
  ConfirmarPracticaInput,
  ConfirmarPracticaResult,
  GenerarPracticaBaseInput,
  InstructorSugerido,
  Modalidad,
  SugerirPracticaInput,
  SugerirPracticaResult,
} from '../models/practiceSlotGeneration.model';
import { AppError } from '../utils/AppError';
import {
  effectivePracticeDuration,
  PRACTICE_DURATION_MINUTES,
  throwPracticeWriteError,
} from '../utils/practiceSlotIntegrity';
import { formatHora, parseFechaCivil, parseHora, toScheduledAtUTC } from '../utils/schoolTimezone';
import type { HoraDelDia } from '../utils/schoolTimezone';

const WINDOW_START_MINUTES = 6 * 60; // 06:00
const WINDOW_END_MINUTES = 22 * 60; // 22:00
const SLOT_DURATION_MINUTES = PRACTICE_DURATION_MINUTES;

interface SessionPlan {
  fechasCiviles: DateTime[];
  fechasISO: string[];
}

function horaToMinutes(hora: HoraDelDia): number {
  return hora.hour * 60 + hora.minute;
}

function assertWithinDayWindow(hora: HoraDelDia, horasPorDia: number): void {
  const start = horaToMinutes(hora);
  const end = start + horasPorDia * SLOT_DURATION_MINUTES;
  if (start < WINDOW_START_MINUTES || end > WINDOW_END_MINUTES) {
    throw new AppError(
      `El horario solicitado (${formatHora(hora)}, ${String(horasPorDia)}h) no cabe entero dentro de la ventana 06:00-22:00`,
      400,
    );
  }
}

function isDiaQueCuenta(fecha: DateTime, modalidad: Modalidad): boolean {
  // Luxon: 1=lunes .. 7=domingo.
  const esFinDeSemana = fecha.weekday === 6 || fecha.weekday === 7;
  return modalidad === 'entre_semana' ? !esFinDeSemana : esFinDeSemana;
}

// Recibe el cliente de Supabase por constructor para poder mockearlo en
// tests (mismo patrón que el resto de servicios de este proyecto).
export class PracticeSlotGenerationService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async sugerir(enrollmentId: string, input: SugerirPracticaInput): Promise<SugerirPracticaResult> {
    effectivePracticeDuration(input.durationMinutes);
    const horaDeseada = parseHora(input.horaDeseada);
    assertWithinDayWindow(horaDeseada, input.horasPorDia);

    // getEnrollmentContext ya valida que la matrícula exista y esté
    // activa; aquí solo hace falta el dato de horas requeridas del curso.
    const { horasRequeridas } = await this.getEnrollmentContext(enrollmentId);
    return this.suggestPlan(input, horasRequeridas);
  }

  async suggestForCourse(
    courseId: string,
    input: SugerirPracticaInput,
  ): Promise<SugerirPracticaResult> {
    const { data, error } = await this.supabase
      .from('courses')
      .select('horas_requeridas')
      .eq('id', courseId)
      .single();
    if (error) throw error;
    return this.suggestPlan(input, data.horas_requeridas);
  }

  private async suggestPlan(
    input: SugerirPracticaInput,
    horasRequeridas: number | null,
  ): Promise<SugerirPracticaResult> {
    effectivePracticeDuration(input.durationMinutes);
    const horaDeseada = parseHora(input.horaDeseada);
    assertWithinDayWindow(horaDeseada, input.horasPorDia);
    const plan = this.buildSessionPlan(input);

    const candidato = await this.buscarHoraConInstructorLibre(
      plan.fechasCiviles,
      horaDeseada,
      input.horasPorDia,
    );
    if (!candidato) {
      throw new AppError(
        'Ningún instructor está completamente libre para este rango dentro de la ventana 06:00-22:00. Ajusta la fecha, la modalidad o las horas por día.',
        409,
      );
    }

    return {
      fechas: plan.fechasCiviles.map((f) => f.toFormat('yyyy-LL-dd')),
      horaDeseada: formatHora(horaDeseada),
      horaResuelta: formatHora(candidato.hora),
      horaAjustada:
        candidato.hora.hour !== horaDeseada.hour || candidato.hora.minute !== horaDeseada.minute,
      instructoresSugeridos: candidato.instructores,
      totalSesiones: plan.fechasCiviles.length,
      horasProgramadas: plan.fechasCiviles.length * input.horasPorDia,
      horasRequeridas,
    };
  }

  async confirmar(
    enrollmentId: string,
    input: ConfirmarPracticaInput,
  ): Promise<ConfirmarPracticaResult> {
    effectivePracticeDuration(input.durationMinutes);
    const horaResuelta = parseHora(input.horaResuelta);
    assertWithinDayWindow(horaResuelta, input.horasPorDia);

    const { studentId, cohortId, horasRequeridas } = await this.getEnrollmentContext(enrollmentId);
    await this.assertInstructorExists(input.instructorId);

    // Recalculada aquí, con los mismos parámetros base — nunca se confía
    // en una lista de fechas que venga del cliente.
    const plan = this.buildSessionPlan(input);
    const scheduledAts = this.buildScheduledAtsForHour(
      plan.fechasCiviles,
      horaResuelta,
      input.horasPorDia,
    );

    await this.assertInstructorFreeFor(input.instructorId, scheduledAts);

    const rows = scheduledAts.map((scheduledAt) => ({
      cohort_id: cohortId,
      instructor_id: input.instructorId,
      student_id: studentId,
      scheduled_at: scheduledAt,
      duration_minutes: SLOT_DURATION_MINUTES,
      status: 'asignado' as const,
    }));

    const { data, error } = await this.supabase.from('practice_slots').insert(rows).select('id');

    if (error) {
      throwPracticeWriteError(error);
    }

    return {
      slotsCreados: data.length,
      horasProgramadas: scheduledAts.length,
      horasRequeridas,
      slotIds: data.map((row) => row.id),
    };
  }

  // El wizard usa el mismo generador real, pero deja la escritura a la RPC
  // transaccional de confirmación (no crea una matrícula al consultar).
  async prepareForTransaction(input: ConfirmarPracticaInput): Promise<string[]> {
    const hora = parseHora(input.horaResuelta);
    assertWithinDayWindow(hora, input.horasPorDia);
    await this.assertInstructorExists(input.instructorId);
    const plan = this.buildSessionPlan(input);
    const scheduled = this.buildScheduledAtsForHour(plan.fechasCiviles, hora, input.horasPorDia);
    await this.assertInstructorFreeFor(input.instructorId, scheduled);
    return scheduled;
  }

  // -----------------------------------------------------------------
  // Algoritmo de fechas/horas
  // -----------------------------------------------------------------

  private buildSessionPlan(input: GenerarPracticaBaseInput): SessionPlan {
    if ((input.fechaFin === undefined) === (input.numeroSesiones === undefined)) {
      throw new AppError('Debes indicar exactamente uno de fechaFin o numeroSesiones', 400);
    }

    const fechaInicio = parseFechaCivil(input.fechaInicio);
    const fechasCiviles: DateTime[] = [];

    if (input.fechaFin !== undefined) {
      const fechaFin = parseFechaCivil(input.fechaFin);
      if (fechaFin < fechaInicio) {
        throw new AppError('fechaFin no puede ser anterior a fechaInicio', 400);
      }
      let cursor = fechaInicio;
      while (cursor <= fechaFin) {
        if (isDiaQueCuenta(cursor, input.modalidad)) {
          fechasCiviles.push(cursor);
        }
        cursor = cursor.plus({ days: 1 });
      }
    } else {
      // La validación de "exactamente uno de fechaFin/numeroSesiones" de
      // arriba garantiza que, al llegar aquí (fechaFin undefined),
      // numeroSesiones sí está definido.
      if (input.numeroSesiones === undefined) {
        throw new AppError('Debes indicar exactamente uno de fechaFin o numeroSesiones', 400);
      }
      const numeroSesiones = input.numeroSesiones;
      if (numeroSesiones < 1) {
        throw new AppError('numeroSesiones debe ser al menos 1', 400);
      }
      let cursor = fechaInicio;
      // Cota de seguridad (2 años de calendario): cualquier modalidad tiene
      // días que cuentan todas las semanas, así que esto nunca debería
      // alcanzarse en uso real — solo evita un loop infinito ante un bug.
      const cursorLimite = fechaInicio.plus({ years: 2 });
      while (fechasCiviles.length < numeroSesiones) {
        if (cursor > cursorLimite) {
          throw new AppError('No se pudo calcular el rango de fechas solicitado', 400);
        }
        if (isDiaQueCuenta(cursor, input.modalidad)) {
          fechasCiviles.push(cursor);
        }
        cursor = cursor.plus({ days: 1 });
      }
    }

    if (fechasCiviles.length === 0) {
      throw new AppError(
        'El rango indicado no contiene ningún día válido para la modalidad elegida',
        400,
      );
    }

    return { fechasCiviles, fechasISO: fechasCiviles.map((f) => f.toFormat('yyyy-LL-dd')) };
  }

  private buildScheduledAtsForHour(
    fechasCiviles: DateTime[],
    hora: HoraDelDia,
    horasPorDia: number,
  ): string[] {
    const scheduledAts: string[] = [];
    for (const fecha of fechasCiviles) {
      for (let bloque = 0; bloque < horasPorDia; bloque += 1) {
        scheduledAts.push(
          toScheduledAtUTC(fecha, { hour: hora.hour + bloque, minute: hora.minute }),
        );
      }
    }
    return scheduledAts;
  }

  // -----------------------------------------------------------------
  // Búsqueda de instructor libre, con expansión de hora
  // -----------------------------------------------------------------

  private async buscarHoraConInstructorLibre(
    fechasCiviles: DateTime[],
    horaDeseada: HoraDelDia,
    horasPorDia: number,
  ): Promise<{ hora: HoraDelDia; instructores: InstructorSugerido[] } | null> {
    for (const offset of this.horasCandidatas(horaDeseada)) {
      if (horaToMinutes(offset) < WINDOW_START_MINUTES) {
        continue;
      }
      if (horaToMinutes(offset) + horasPorDia * SLOT_DURATION_MINUTES > WINDOW_END_MINUTES) {
        continue;
      }

      const scheduledAts = this.buildScheduledAtsForHour(fechasCiviles, offset, horasPorDia);
      const instructores = await this.findFreeInstructors(scheduledAts);
      if (instructores.length > 0) {
        return { hora: offset, instructores };
      }
    }
    return null;
  }

  // Genera las horas candidatas a partir de horaDeseada, expandiendo de a
  // una hora en ambas direcciones (0, -1, +1, -2, +2, ...) sin salirse
  // nunca de un rango razonable — el filtro real de 06:00-22:00 se aplica
  // en buscarHoraConInstructorLibre para poder seguir expandiendo del lado
  // que todavía tenga margen aunque el otro ya se haya salido de rango.
  private horasCandidatas(horaDeseada: HoraDelDia): HoraDelDia[] {
    const maxOffsetHoras = (WINDOW_END_MINUTES - WINDOW_START_MINUTES) / 60;
    const candidatas: HoraDelDia[] = [{ ...horaDeseada }];
    for (let delta = 1; delta <= maxOffsetHoras; delta += 1) {
      candidatas.push({ hour: horaDeseada.hour - delta, minute: horaDeseada.minute });
      candidatas.push({ hour: horaDeseada.hour + delta, minute: horaDeseada.minute });
    }
    return candidatas;
  }

  private async findFreeInstructors(scheduledAts: string[]): Promise<InstructorSugerido[]> {
    const { data, error } = await this.supabase.rpc('practice_free_instructors', {
      p_scheduled_ats: scheduledAts,
    });
    if (error) {
      throw error;
    }
    return data.map((instructor) => ({
      id: instructor.id,
      nombreCompleto: instructor.nombre_completo,
    }));
  }

  private async assertInstructorFreeFor(
    instructorId: string,
    scheduledAts: string[],
  ): Promise<void> {
    const { data, error } = await this.supabase.rpc('practice_free_instructors', {
      p_scheduled_ats: scheduledAts,
      p_instructor_id: instructorId,
    });
    if (error) {
      throw error;
    }
    if (data.length === 0) {
      throw new AppError(
        'El instructor elegido ya no está libre para este rango. Vuelve a pedir una sugerencia.',
        409,
      );
    }
  }

  // -----------------------------------------------------------------
  // Helpers de datos
  // -----------------------------------------------------------------

  private async getEnrollmentContext(
    enrollmentId: string,
  ): Promise<{ studentId: string; cohortId: string; horasRequeridas: number | null }> {
    const { data: enrollment, error } = await this.supabase
      .from('enrollments')
      .select('student_id, cohort_id, status')
      .eq('id', enrollmentId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!enrollment) {
      throw new AppError('La matrícula indicada no existe', 404);
    }
    if (enrollment.status !== 'activo') {
      throw new AppError('Solo se puede generar práctica para una matrícula activa', 409);
    }
    if (enrollment.cohort_id === null) {
      // Invariante de la base de datos: status='activo' implica cohort_id
      // no nulo (enrollments_pendiente_cohorte_shape). Si esto se
      // dispara, hay una inconsistencia real, no un caso de negocio.
      throw new AppError('La matrícula activa no tiene cohorte asignada', 500);
    }

    const { data: cohort, error: cohortError } = await this.supabase
      .from('cohorts')
      .select('course_id')
      .eq('id', enrollment.cohort_id)
      .maybeSingle();
    if (cohortError) {
      throw cohortError;
    }

    let horasRequeridas: number | null = null;
    if (cohort) {
      const { data: course, error: courseError } = await this.supabase
        .from('courses')
        .select('horas_requeridas')
        .eq('id', cohort.course_id)
        .maybeSingle();
      if (courseError) {
        throw courseError;
      }
      horasRequeridas = course?.horas_requeridas ?? null;
    }

    return { studentId: enrollment.student_id, cohortId: enrollment.cohort_id, horasRequeridas };
  }

  private async assertInstructorExists(instructorId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, rol')
      .eq('id', instructorId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('El instructor indicado no existe', 404);
    }
    if (data.rol !== 'instructor') {
      throw new AppError('El usuario indicado no tiene rol instructor', 400);
    }
  }
}
