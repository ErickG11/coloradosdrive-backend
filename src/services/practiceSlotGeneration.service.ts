import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

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
  formatHora,
  parseFechaCivil,
  parseHora,
  SCHOOL_TIMEZONE,
  toScheduledAtUTC,
} from '../utils/schoolTimezone';
import type { HoraDelDia } from '../utils/schoolTimezone';

const WINDOW_START_MINUTES = 6 * 60; // 06:00
const WINDOW_END_MINUTES = 22 * 60; // 22:00
const SLOT_DURATION_MINUTES = 60;
// Estos son los únicos estados que cuentan como "instructor ocupado" — los
// mismos que cubre el índice único practice_slots_instructor_no_overlap
// (migración 010). liberado/sin_practica/completado son estados históricos
// que no bloquean reutilizar ese instructor+hora.
const OCCUPIED_STATUSES = ['disponible', 'asignado', 'confirmado'] as const;
const POSTGRES_UNIQUE_VIOLATION = '23505';

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

function displayFechaHora(iso: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(SCHOOL_TIMEZONE)
    .toFormat('yyyy-LL-dd HH:mm');
}

// Recibe el cliente de Supabase por constructor para poder mockearlo en
// tests (mismo patrón que el resto de servicios de este proyecto).
export class PracticeSlotGenerationService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async sugerir(enrollmentId: string, input: SugerirPracticaInput): Promise<SugerirPracticaResult> {
    const horaDeseada = parseHora(input.horaDeseada);
    assertWithinDayWindow(horaDeseada, input.horasPorDia);

    // getEnrollmentContext ya valida que la matrícula exista y esté
    // activa; aquí solo hace falta el dato de horas requeridas del curso.
    const { horasRequeridas } = await this.getEnrollmentContext(enrollmentId);
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
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        throw new AppError(this.describeUniqueViolation(error), 409);
      }
      throw error;
    }

    return {
      slotsCreados: data.length,
      horasProgramadas: scheduledAts.length,
      horasRequeridas,
      slotIds: data.map((row) => row.id),
    };
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
    const { data: instructores, error: instructoresError } = await this.supabase
      .from('users')
      .select('id, nombre_completo')
      .eq('rol', 'instructor')
      .order('nombre_completo');
    if (instructoresError) {
      throw instructoresError;
    }
    if (instructores.length === 0) {
      return [];
    }

    const { data: ocupados, error: ocupadosError } = await this.supabase
      .from('practice_slots')
      .select('instructor_id')
      .in('scheduled_at', scheduledAts)
      .in('status', OCCUPIED_STATUSES);
    if (ocupadosError) {
      throw ocupadosError;
    }

    const instructoresOcupados = new Set(ocupados.map((row) => row.instructor_id));
    return instructores
      .filter((instructor) => !instructoresOcupados.has(instructor.id))
      .map((instructor) => ({ id: instructor.id, nombreCompleto: instructor.nombre_completo }));
  }

  private async assertInstructorFreeFor(
    instructorId: string,
    scheduledAts: string[],
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('practice_slots')
      .select('scheduled_at')
      .eq('instructor_id', instructorId)
      .in('scheduled_at', scheduledAts)
      .in('status', OCCUPIED_STATUSES);
    if (error) {
      throw error;
    }
    if (data.length > 0) {
      const conflictos = data.map((row) => displayFechaHora(row.scheduled_at)).join(', ');
      throw new AppError(
        `El instructor elegido ya no está libre para: ${conflictos}. Vuelve a pedir una sugerencia.`,
        409,
      );
    }
  }

  private describeUniqueViolation(error: PostgrestError): string {
    // Postgres reporta el valor que chocó en `details`, ej.:
    // 'Key (instructor_id, scheduled_at)=(uuid, 2026-03-02 20:00:00+00) already exists.'
    // Si el formato cambia entre versiones, se cae a un mensaje genérico
    // en vez de fallar la respuesta de error en sí.
    const match = /scheduled_at\)=\([^,]+,\s*([^)]+)\)/.exec(error.details);
    if (match) {
      const iso = new Date(match[1]).toISOString();
      return `El instructor elegido ya no está libre para ${displayFechaHora(iso)}. Vuelve a pedir una sugerencia.`;
    }
    return 'El instructor elegido ya no está libre para una de estas fechas (otra matriculación se adelantó). Vuelve a pedir una sugerencia.';
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
