import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { Cohort, CreateCohortInput, UpdateCohortInput } from '../models/cohort.model';
import { AppError } from '../utils/AppError';

type CohortRow = Database['public']['Tables']['cohorts']['Row'];

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

  async createCohort(input: CreateCohortInput): Promise<Cohort> {
    const { data: course, error: courseError } = await this.supabase
      .from('courses')
      .select('id')
      .eq('id', input.courseId)
      .maybeSingle();

    if (courseError) {
      throw courseError;
    }
    if (!course) {
      throw new AppError('El curso indicado no existe', 404);
    }

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
      throw error;
    }

    return toCohort(data);
  }

  async listCohorts(): Promise<Cohort[]> {
    const { data, error } = await this.supabase
      .from('cohorts')
      .select()
      .order('fecha_inicio_curso', { ascending: false });

    if (error) {
      throw error;
    }

    return data.map(toCohort);
  }

  async updateCohort(id: string, input: UpdateCohortInput): Promise<Cohort> {
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
      throw error;
    }
    if (!data) {
      throw new AppError('Cohorte no encontrada', 404);
    }

    return toCohort(data);
  }
}
