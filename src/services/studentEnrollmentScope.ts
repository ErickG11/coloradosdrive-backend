import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';

export async function activeCohortIds(
  client: SupabaseClient<Database>,
  studentId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('enrollments')
    .select('cohort_id')
    .eq('student_id', studentId)
    .eq('status', 'activo');
  if (error) throw error;
  return [...new Set(data.flatMap((e) => (e.cohort_id === null ? [] : [e.cohort_id])))];
}
export async function activeCourseIds(
  client: SupabaseClient<Database>,
  studentId: string,
): Promise<string[]> {
  const cohorts = await activeCohortIds(client, studentId);
  if (!cohorts.length) return [];
  const { data, error } = await client.from('cohorts').select('course_id').in('id', cohorts);
  if (error) throw error;
  return [...new Set(data.map((c) => c.course_id))];
}
