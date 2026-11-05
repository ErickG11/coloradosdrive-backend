import { DateTime } from 'luxon';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { StudentScheduleConfig } from '../config/studentScheduleConfig';
import type {
  StudentScheduleAvailability,
  StudentScheduleInput,
  StudentScheduleReservation,
  StudentScheduleSelection,
} from '../models/studentSchedule.model';
import { AppError } from '../utils/AppError';
import { parseFechaCivil, SCHOOL_TIMEZONE, toScheduledAtUTC } from '../utils/schoolTimezone';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { PracticeSlotGenerationService } from './practiceSlotGeneration.service';

type Db = SupabaseClient<Database>;
type Cohort = Pick<
  Database['public']['Tables']['cohorts']['Row'],
  | 'id'
  | 'fecha_inicio_curso'
  | 'fecha_fin_curso'
  | 'fecha_inicio_matricula'
  | 'fecha_fin_matricula'
  | 'cupo_maximo'
>;
const INVALID = (): AppError =>
  new AppError('Revisa la modalidad, fecha de inicio y horas por día.', 400, {
    code: 'PLAN_INVALIDO',
  });

export class StudentScheduleService {
  private readonly planner: PracticeSlotGenerationService;
  constructor(
    private readonly db: Db,
    private readonly config: StudentScheduleConfig,
  ) {
    this.planner = new PracticeSlotGenerationService(db);
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

  private dates(input: StudentScheduleInput, required: number): string[] {
    if (
      !['entre_semana', 'fin_de_semana'].includes(input.modalidad) ||
      !Number.isInteger(input.horasPorDia) ||
      input.horasPorDia < 1 ||
      input.horasPorDia > 6
    )
      throw INVALID();
    const start = parseFechaCivil(input.fechaInicio);
    const today = DateTime.now().setZone(SCHOOL_TIMEZONE).startOf('day');
    if (start < today || start > today.plus({ days: 365 })) throw INVALID();
    return this.planner.sessionDates({
      ...input,
      numeroSesiones: Math.ceil(required / input.horasPorDia),
    });
  }

  private contains(cohort: Cohort, dates: string[], today: string): boolean {
    return (
      cohort.fecha_inicio_matricula <= today &&
      today <= cohort.fecha_fin_matricula &&
      dates[0] >= cohort.fecha_inicio_curso &&
      dates[dates.length - 1] <=
        parseFechaCivil(cohort.fecha_fin_curso)
          .minus({ days: this.config.COHORT_MARGIN_DAYS })
          .toFormat('yyyy-LL-dd')
    );
  }

  async availability(
    studentId: string,
    enrollmentId: string,
    input: StudentScheduleInput,
  ): Promise<StudentScheduleAvailability> {
    await this.expire(studentId);
    const { courseId, required } = await this.context(studentId, enrollmentId);
    const dates = this.dates(input, required);
    const today = DateTime.now().setZone(SCHOOL_TIMEZONE).toFormat('yyyy-LL-dd');
    const cohorts = await this.db
      .from('cohorts')
      .select(
        'id,fecha_inicio_curso,fecha_fin_curso,fecha_inicio_matricula,fecha_fin_matricula,cupo_maximo',
      )
      .eq('course_id', courseId)
      .lte('fecha_inicio_matricula', today)
      .gte('fecha_fin_matricula', today)
      .order('fecha_inicio_curso')
      .order('id');
    if (cohorts.error) throwStudentScheduleError(cohorts.error);
    const candidates = cohorts.data.filter((c) => this.contains(c, dates, today));
    let eligible = false;
    if (candidates.length) {
      const counts = await this.db.rpc('cohort_cupos_ocupados', {
        p_cohorts: candidates.map((c) => c.id),
      });
      if (counts.error) throwStudentScheduleError(counts.error);
      const occupied = new Map(counts.data.map((c) => [c.cohort_id, c.ocupados]));
      eligible = candidates.some(
        (c) => occupied.has(c.id) && (occupied.get(c.id) ?? Infinity) < c.cupo_maximo,
      );
    }
    const cells = dates.flatMap((date) =>
      Array.from({ length: 16 }, (_, i) => ({
        date,
        hour: i + 6,
        scheduled: toScheduledAtUTC(parseFechaCivil(date), { hour: i + 6, minute: 0 }),
      })),
    );
    const free = new Map<number, boolean>();
    if (eligible) {
      const result = await this.db.rpc('student_schedule_free_slots', {
        p_slots: cells.map((c) => c.scheduled),
      });
      if (result.error) throwStudentScheduleError(result.error);
      for (const slot of result.data) free.set(Date.parse(slot.scheduled_at), slot.libre);
      // Una matrícula manual coexistente no permite solapar al mismo alumno.
      const busy = await this.db
        .from('practice_slots')
        .select('scheduled_at')
        .eq('student_id', studentId)
        .in('status', ['asignado', 'confirmado', 'completado'])
        .gte('scheduled_at', new Date(Date.parse(cells[0].scheduled) - 3_600_000).toISOString())
        .lte(
          'scheduled_at',
          new Date(Date.parse(cells[cells.length - 1].scheduled) + 3_600_000).toISOString(),
        );
      if (busy.error) throwStudentScheduleError(busy.error);
      for (const slot of busy.data) {
        const time = Date.parse(slot.scheduled_at);
        for (const cell of cells)
          if (Math.abs(Date.parse(cell.scheduled) - time) < 3_600_000)
            free.set(Date.parse(cell.scheduled), false);
      }
    }
    const days = dates.map((date, index) => ({
      fecha: date,
      horasASeleccionar: Math.min(input.horasPorDia, required - index * input.horasPorDia),
      franjas: cells
        .filter((c) => c.date === date)
        .map((c) => ({
          hora: `${String(c.hour).padStart(2, '0')}:00`,
          libre: free.get(Date.parse(c.scheduled)) === true,
        })),
    }));
    const available =
      eligible && days.every((d) => d.franjas.filter((s) => s.libre).length >= d.horasASeleccionar);
    const suggestions: string[] = [];
    if (!available) {
      // Fechas orientativas, jamás una promesa de cupo: el alumno vuelve a consultar.
      for (const c of cohorts.data) {
        const start =
          c.fecha_inicio_curso > input.fechaInicio
            ? c.fecha_inicio_curso
            : parseFechaCivil(input.fechaInicio).plus({ days: 7 }).toFormat('yyyy-LL-dd');
        try {
          const alternative = this.dates({ ...input, fechaInicio: start }, required);
          if (this.contains(c, alternative, today) && !suggestions.includes(start))
            suggestions.push(start);
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
        }
        if (suggestions.length === 3) break;
      }
    }
    return {
      enrollmentId,
      serverNow: new Date().toISOString(),
      horasRequeridas: required,
      dias: days,
      disponible: available,
      fechasSugeridas: suggestions,
      mensaje: available
        ? null
        : eligible
          ? 'No hay suficientes franjas libres en todas las fechas. Prueba otro inicio.'
          : 'No hay una cohorte con cupo que contenga todo el plan y el margen final. Prueba un inicio posterior o consulta a la escuela.',
    };
  }

  async reserve(
    studentId: string,
    enrollmentId: string,
    input: StudentScheduleSelection,
  ): Promise<StudentScheduleReservation> {
    await this.expire(studentId);
    const { required } = await this.context(studentId, enrollmentId);
    const dates = this.dates(input, required);
    if (!Array.isArray(input.franjas) || input.franjas.length !== required) throw INVALID();
    const slots = input.franjas.map((s) => {
      if (!dates.includes(s.fecha) || !/^(0[6-9]|1\d|2[01]):00$/.test(s.hora)) throw INVALID();
      return toScheduledAtUTC(parseFechaCivil(s.fecha), {
        hour: Number(s.hora.slice(0, 2)),
        minute: 0,
      });
    });
    if (new Set(slots).size !== slots.length) throw INVALID();
    dates.forEach((date, index) => {
      if (
        input.franjas.filter((s) => s.fecha === date).length !==
        Math.min(input.horasPorDia, required - index * input.horasPorDia)
      )
        throw INVALID();
    });
    // SQL vuelve a elegir cohorte por inicio, instructor POR FRANJA y cupo bajo locks.
    // El cliente nunca propone cohorte, instructor ni precio.
    const result = await this.db.rpc('reserve_student_schedule', {
      p_student: studentId,
      p_enrollment: enrollmentId,
      p_slots: slots,
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

  private present(reservation: StudentScheduleReservation): StudentScheduleReservation {
    return {
      ...reservation,
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

  async expire(studentId: string): Promise<number> {
    const result = await this.db.rpc('expire_student_reservations', { p_student: studentId });
    if (result.error) throwStudentScheduleError(result.error);
    return result.data;
  }
}
