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
    fechaInicio: row.fecha_inicio,
    fechaFin: row.fecha_fin,
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
        fecha_inicio: input.fechaInicio,
        fecha_fin: input.fechaFin,
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
      .order('fecha_inicio', { ascending: false });

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
    if (input.fechaInicio !== undefined) updatePayload.fecha_inicio = input.fechaInicio;
    if (input.fechaFin !== undefined) updatePayload.fecha_fin = input.fechaFin;

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
