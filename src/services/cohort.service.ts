import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import type { Database } from '../config/database.types';
import type {
  Cohort,
  CohortDetail,
  CohortStudentCounts,
  CreateCohortInput,
  UpdateCohortInput,
} from '../models/cohort.model';
import { AppError } from '../utils/AppError';
import {
  assertCohortDates,
  COHORT_MESSAGES as M,
  normalizeCohortName,
  withCount,
} from '../utils/cohortRules';
import { mapPostgresError, type PostgresErrorOverride } from '../utils/postgresError';
import { SCHOOL_TIMEZONE } from '../utils/schoolTimezone';

type CohortRow = Database['public']['Tables']['cohorts']['Row'];
type CohortUpdate = Database['public']['Tables']['cohorts']['Update'];

const invalidField = (message: string, field: string): PostgresErrorOverride => ({
  status: 400,
  message,
  code: 'INVALID_FIELD',
  field,
});

// F-03: restricciones de `cohorts` (001, 012 y 029) con su mensaje y campo.
// Son la red de seguridad si el validador o la comprobación previa no
// alcanzan (p. ej. dos altas simultáneas con el mismo nombre).
const COHORT_CONSTRAINTS: Record<string, PostgresErrorOverride> = {
  cohorts_course_nombre_unique: {
    status: 409,
    message: M.nombreDuplicado,
    code: 'COHORT_NAME_DUPLICATE',
    field: 'nombre',
  },
  cohorts_course_id_fkey: {
    status: 404,
    message: M.cursoNoExiste,
    code: 'COURSE_NOT_FOUND',
    field: 'courseId',
  },
  // Red de seguridad de 4.2: matrícula creada entre la comprobación y el UPDATE.
  enrollments_cohort_course_fkey: {
    status: 409,
    message: M.cursoConAlumnos,
    code: 'COHORT_HAS_STUDENTS',
    field: 'courseId',
  },
  cohorts_nombre_longitud: invalidField(M.nombreLargo, 'nombre'),
  cohorts_precio_non_negative: invalidField(M.precioRango, 'precio'),
  cohorts_precio_maximo: invalidField(M.precioRango, 'precio'),
  cohorts_cupo_positive: invalidField(M.cupo, 'cupoMaximo'),
  cohorts_cupo_maximo_rango: invalidField(M.cupo, 'cupoMaximo'),
  cohorts_vehiculos_rango: invalidField(M.vehiculos, 'numeroVehiculos'),
  cohorts_aulas_rango: invalidField(M.aulas, 'numeroAulas'),
  cohorts_fechas_matricula_validas: invalidField(M.finMatriculaAntesInicio, 'fechaFinMatricula'),
  cohorts_fechas_curso_validas: invalidField(M.finCursoAntesInicio, 'fechaFinCurso'),
  cohorts_curso_no_antes_matricula: invalidField(M.cursoAntesMatricula, 'fechaFinCurso'),
};

export function cohortError(error: unknown): unknown {
  return mapPostgresError(error, COHORT_CONSTRAINTS) ?? error;
}

function toUpdatePayload(input: UpdateCohortInput): CohortUpdate {
  const payload: CohortUpdate = {};
  if (input.courseId !== undefined) payload.course_id = input.courseId;
  if (input.nombre !== undefined) payload.nombre = input.nombre;
  if (input.precio !== undefined) payload.precio = input.precio;
  if (input.cupoMaximo !== undefined) payload.cupo_maximo = input.cupoMaximo;
  if (input.fechaInicioMatricula !== undefined) {
    payload.fecha_inicio_matricula = input.fechaInicioMatricula;
  }
  if (input.fechaFinMatricula !== undefined) payload.fecha_fin_matricula = input.fechaFinMatricula;
  if (input.fechaInicioCurso !== undefined) payload.fecha_inicio_curso = input.fechaInicioCurso;
  if (input.fechaFinCurso !== undefined) payload.fecha_fin_curso = input.fechaFinCurso;
  if (input.tipoModalidad !== undefined) payload.tipo_modalidad = input.tipoModalidad;
  if (input.horariosCapacitacionTeoria !== undefined) {
    payload.horarios_capacitacion_teoria = input.horariosCapacitacionTeoria;
  }
  if (input.numeroVehiculos !== undefined) payload.numero_vehiculos = input.numeroVehiculos;
  if (input.numeroAulas !== undefined) payload.numero_aulas = input.numeroAulas;
  return payload;
}

const notFound = (): AppError => new AppError(M.cohorteNoExiste, 404, { code: 'COHORT_NOT_FOUND' });

function toCohort(row: CohortRow): Cohort {
  return {
    id: row.id,
    courseId: row.course_id,
    nombre: row.nombre,
    precio: Number(row.precio),
    cupoMaximo: row.cupo_maximo,
    fechaInicioMatricula: row.fecha_inicio_matricula,
    fechaFinMatricula: row.fecha_fin_matricula,
    fechaInicioCurso: row.fecha_inicio_curso,
    fechaFinCurso: row.fecha_fin_curso,
    tipoModalidad: row.tipo_modalidad,
    horariosCapacitacionTeoria: row.horarios_capacitacion_teoria,
    numeroVehiculos: row.numero_vehiculos,
    numeroAulas: row.numero_aulas,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Recibe el cliente de Supabase por constructor para poder mockearlo en tests.
export class CohortService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  // 3.4: nombre único por curso sin distinguir mayúsculas ni espacios
  // extremos; en PATCH la propia cohorte (`excludeId`) no choca consigo misma.
  private async assertNameAvailable(
    courseId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    let query = this.supabase.from('cohorts').select('id,nombre').eq('course_id', courseId);
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    const target = normalizeCohortName(nombre);
    if (data.some((row) => normalizeCohortName(row.nombre) === target)) {
      throw new AppError(M.nombreDuplicado, 409, {
        code: 'COHORT_NAME_DUPLICATE',
        field: 'nombre',
      });
    }
  }

  async createCohort(input: CreateCohortInput): Promise<Cohort> {
    assertCohortDates(input);

    const { data: course, error: courseError } = await this.supabase
      .from('courses')
      .select('id')
      .eq('id', input.courseId)
      .maybeSingle();

    if (courseError) {
      throw courseError;
    }
    if (!course) {
      throw new AppError(M.cursoNoExiste, 404, { code: 'COURSE_NOT_FOUND', field: 'courseId' });
    }

    await this.assertNameAvailable(input.courseId, input.nombre);

    const { data, error } = await this.supabase
      .from('cohorts')
      .insert({
        course_id: input.courseId,
        nombre: input.nombre,
        precio: input.precio,
        cupo_maximo: input.cupoMaximo,
        fecha_inicio_matricula: input.fechaInicioMatricula,
        fecha_fin_matricula: input.fechaFinMatricula,
        fecha_inicio_curso: input.fechaInicioCurso,
        fecha_fin_curso: input.fechaFinCurso,
        tipo_modalidad: input.tipoModalidad ?? null,
        horarios_capacitacion_teoria: input.horariosCapacitacionTeoria ?? null,
        numero_vehiculos: input.numeroVehiculos ?? null,
        numero_aulas: input.numeroAulas ?? null,
      })
      .select()
      .single();

    if (error) {
      throw cohortError(error);
    }

    return toCohort(data);
  }

  async listCohorts(): Promise<Cohort[]> {
    const { data, error } = await this.supabase
      .from('cohorts')
      .select()
      .order('fecha_inicio_curso', { ascending: false })
      // Desempate fijo (5.2): sin él, las cohortes con la misma fecha de
      // inicio salían en orden indefinido. Alumnos y Horarios de práctica
      // usan esta misma lista: el criterio principal no cambia.
      .order('created_at', { ascending: false })
      .order('id', { ascending: true });

    if (error) {
      throw error;
    }

    return data.map(toCohort);
  }

  private async readCohort(id: string): Promise<CohortRow> {
    const { data, error } = await this.supabase.from('cohorts').select().eq('id', id).maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw notFound();
    }
    return data;
  }

  // Matrículas asociadas por estado (una sola consulta). `activos` usa el
  // mismo criterio que enforce_cohort_cupo (status = 'activo').
  private async studentCounts(id: string): Promise<CohortStudentCounts> {
    const { data, error } = await this.supabase
      .from('enrollments')
      .select('status')
      .eq('cohort_id', id);
    if (error) {
      throw error;
    }
    const by = (status: string): number => data.filter((row) => row.status === status).length;
    return {
      total: data.length,
      activos: by('activo'),
      finalizados: by('finalizado'),
      retirados: by('retirado'),
    };
  }

  async getCohort(id: string): Promise<CohortDetail> {
    const row = await this.readCohort(id);
    return { ...toCohort(row), alumnos: await this.studentCounts(id) };
  }

  // Franjas de práctica de la cohorte que quedarían fuera de la ventana de
  // curso [inicio 00:00, fin 24:00) en la zona horaria de la escuela.
  private async assertSlotsInsideWindow(
    id: string,
    fechaInicioCurso: string,
    fechaFinCurso: string,
  ): Promise<void> {
    const start = DateTime.fromISO(fechaInicioCurso, { zone: SCHOOL_TIMEZONE }).toUTC().toISO();
    const end = DateTime.fromISO(fechaFinCurso, { zone: SCHOOL_TIMEZONE })
      .plus({ days: 1 })
      .toUTC()
      .toISO();
    if (start === null || end === null) {
      throw new AppError(M.fechaInicioCurso, 400, { code: 'INVALID_FIELD' });
    }
    const { data, error } = await this.supabase
      .from('practice_slots')
      .select('scheduled_at')
      .eq('cohort_id', id)
      .or(`scheduled_at.lt.${start},scheduled_at.gte.${end}`);
    if (error) {
      throw error;
    }
    if (data.length > 0) {
      const before = data.some((slot) => new Date(slot.scheduled_at) < new Date(start));
      throw new AppError(withCount(M.franjasFueraVentana, data.length), 409, {
        code: 'COHORT_SLOTS_OUTSIDE_WINDOW',
        field: before ? 'fechaInicioCurso' : 'fechaFinCurso',
      });
    }
  }

  async updateCohort(id: string, input: UpdateCohortInput): Promise<Cohort> {
    const updatePayload = toUpdatePayload(input);
    if (Object.keys(updatePayload).length === 0) {
      throw new AppError(M.sinCambios, 400, { code: 'NO_CHANGES' });
    }

    const current = await this.readCohort(id);
    const fechaInicioCurso = input.fechaInicioCurso ?? current.fecha_inicio_curso;
    const fechaFinCurso = input.fechaFinCurso ?? current.fecha_fin_curso;

    // F-01/3.7: en un PATCH parcial las fechas no enviadas son las guardadas.
    assertCohortDates({
      fechaInicioMatricula: input.fechaInicioMatricula ?? current.fecha_inicio_matricula,
      fechaFinMatricula: input.fechaFinMatricula ?? current.fecha_fin_matricula,
      fechaInicioCurso,
      fechaFinCurso,
    });

    const courseChanges = input.courseId !== undefined && input.courseId !== current.course_id;
    const cupoLowered = input.cupoMaximo !== undefined && input.cupoMaximo < current.cupo_maximo;
    if (courseChanges || cupoLowered) {
      const alumnos = await this.studentCounts(id);
      // Cualquier matrícula (activa, finalizada o retirada) ata la cohorte a
      // su curso: la FK compuesta de enrollments lo impediría igualmente.
      if (courseChanges && alumnos.total > 0) {
        throw new AppError(withCount(M.cursoConAlumnos, alumnos.total), 409, {
          code: 'COHORT_HAS_STUDENTS',
          field: 'courseId',
        });
      }
      // F-02: no bajar el cupo por debajo de los alumnos que ya lo ocupan.
      if (cupoLowered && input.cupoMaximo !== undefined && input.cupoMaximo < alumnos.activos) {
        throw new AppError(withCount(M.cupoBajoActivos, alumnos.activos), 409, {
          code: 'COHORT_CUPO_BELOW_ACTIVE',
          field: 'cupoMaximo',
        });
      }
    }

    if (input.nombre !== undefined || input.courseId !== undefined) {
      await this.assertNameAvailable(
        input.courseId ?? current.course_id,
        input.nombre ?? current.nombre,
        id,
      );
    }

    if (
      fechaInicioCurso !== current.fecha_inicio_curso ||
      fechaFinCurso !== current.fecha_fin_curso
    ) {
      await this.assertSlotsInsideWindow(id, fechaInicioCurso, fechaFinCurso);
    }

    // 4.1: un solo UPDATE condicionado a la versión base (atómico). Dos
    // guardados simultáneos con la misma versión no pueden ganar ambos: el
    // trigger cohorts_set_updated_at cambia updated_at en cada escritura.
    const { data, error } = await this.supabase
      .from('cohorts')
      .update(updatePayload)
      .eq('id', id)
      .eq('updated_at', input.updatedAt)
      .select()
      .maybeSingle();

    if (error) {
      throw cohortError(error);
    }
    if (!data) {
      // Sin fila: o la cohorte ya no existe (404) o cambió de versión (409).
      await this.readCohort(id);
      throw new AppError(M.versionConflicto, 409, { code: 'VERSION_CONFLICT' });
    }

    return toCohort(data);
  }
}
