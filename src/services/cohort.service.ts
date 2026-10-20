import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { Cohort, CreateCohortInput, UpdateCohortInput } from '../models/cohort.model';
import { AppError } from '../utils/AppError';
import { assertCohortDates, COHORT_MESSAGES as M, normalizeCohortName } from '../utils/cohortRules';
import { mapPostgresError, type PostgresErrorOverride } from '../utils/postgresError';

type CohortRow = Database['public']['Tables']['cohorts']['Row'];

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

  async updateCohort(id: string, input: UpdateCohortInput): Promise<Cohort> {
    const { data: current, error: readError } = await this.supabase
      .from('cohorts')
      .select()
      .eq('id', id)
      .maybeSingle();
    if (readError) {
      throw readError;
    }
    if (!current) {
      throw notFound();
    }

    // F-01/3.7: en un PATCH parcial las fechas no enviadas son las guardadas.
    assertCohortDates({
      fechaInicioMatricula: input.fechaInicioMatricula ?? current.fecha_inicio_matricula,
      fechaFinMatricula: input.fechaFinMatricula ?? current.fecha_fin_matricula,
      fechaInicioCurso: input.fechaInicioCurso ?? current.fecha_inicio_curso,
      fechaFinCurso: input.fechaFinCurso ?? current.fecha_fin_curso,
    });
    if (input.nombre !== undefined || input.courseId !== undefined) {
      await this.assertNameAvailable(
        input.courseId ?? current.course_id,
        input.nombre ?? current.nombre,
        id,
      );
    }

    const updatePayload: Database['public']['Tables']['cohorts']['Update'] = {};
    if (input.courseId !== undefined) updatePayload.course_id = input.courseId;
    if (input.nombre !== undefined) updatePayload.nombre = input.nombre;
    if (input.precio !== undefined) updatePayload.precio = input.precio;
    if (input.cupoMaximo !== undefined) updatePayload.cupo_maximo = input.cupoMaximo;
    if (input.fechaInicioMatricula !== undefined) {
      updatePayload.fecha_inicio_matricula = input.fechaInicioMatricula;
    }
    if (input.fechaFinMatricula !== undefined) {
      updatePayload.fecha_fin_matricula = input.fechaFinMatricula;
    }
    if (input.fechaInicioCurso !== undefined) {
      updatePayload.fecha_inicio_curso = input.fechaInicioCurso;
    }
    if (input.fechaFinCurso !== undefined) {
      updatePayload.fecha_fin_curso = input.fechaFinCurso;
    }
    if (input.tipoModalidad !== undefined) updatePayload.tipo_modalidad = input.tipoModalidad;
    if (input.horariosCapacitacionTeoria !== undefined) {
      updatePayload.horarios_capacitacion_teoria = input.horariosCapacitacionTeoria;
    }
    if (input.numeroVehiculos !== undefined) {
      updatePayload.numero_vehiculos = input.numeroVehiculos;
    }
    if (input.numeroAulas !== undefined) updatePayload.numero_aulas = input.numeroAulas;

    const { data, error } = await this.supabase
      .from('cohorts')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      throw cohortError(error);
    }
    if (!data) {
      throw notFound();
    }

    return toCohort(data);
  }
}
