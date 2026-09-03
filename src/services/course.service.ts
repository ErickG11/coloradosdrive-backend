import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { Course } from '../models/course.model';

type CourseRow = Database['public']['Tables']['courses']['Row'];

function toCourse(row: CourseRow): Course {
  return {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    descripcion: row.descripcion,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Recibe el cliente de Supabase por constructor para poder mockearlo en tests.
export class CourseService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listCourses(): Promise<Course[]> {
    const { data, error } = await this.supabase.from('courses').select().order('nombre');

    if (error) {
      throw error;
    }

    return data.map(toCourse);
  }
}
