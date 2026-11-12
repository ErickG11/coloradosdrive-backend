import { individualEnrollmentAccess } from './individualEnrollmentAccess.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';

export async function activeCohortIds(
  client: SupabaseClient<Database>,
  studentId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('enrollments')
    .select('id,cohort_id')
    .eq('student_id', studentId)
    .eq('status', 'activo');
  if (error) throw error;
  const access = await individualEnrollmentAccess(client, studentId);
  const allowed = new Set(access.enrollments.filter((e) => e.eligible).map((e) => e.id));
  return [
    ...new Set(
      data
        .filter((e) => !access.active || allowed.has(e.id))
        .flatMap((e) => (e.cohort_id === null ? [] : [e.cohort_id])),
    ),
  ];
}
export async function activeCourseIds(
  client: SupabaseClient<Database>,
  studentId: string,
): Promise<string[]> {
  const access = await individualEnrollmentAccess(client, studentId);
  if (access.active)
    return [...new Set(access.enrollments.filter((e) => e.eligible).map((e) => e.courseId))];
  const cohorts = await activeCohortIds(client, studentId);
  if (!cohorts.length) return [];
  const { data, error } = await client.from('cohorts').select('course_id').in('id', cohorts);
  if (error) throw error;
  return [...new Set(data.map((c) => c.course_id))];
}
