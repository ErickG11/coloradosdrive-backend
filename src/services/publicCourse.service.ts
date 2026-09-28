import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { PublicCourse } from '../models/publicCourse.model';

// Recibe el cliente de Supabase por constructor para poder mockearlo en tests.
export class PublicCourseService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listPublicCourses(): Promise<PublicCourse[]> {
    // select() explícito de columnas (no `select()` a secas como en
    // CourseService): es la garantía real de que un campo nuevo agregado
    // a `courses` (precio, lo que sea) no se filtra aquí por accidente.
    const { data, error } = await this.supabase
      .from('courses')
      .select('id, tipo, nombre, horas_requeridas')
      .order('tipo');

    if (error) {
      throw error;
    }

    return data.map((row) => ({
      id: row.id,
      tipo: row.tipo,
      nombre: row.nombre,
      horasRequeridas: row.horas_requeridas,
    }));
  }
}
