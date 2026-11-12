import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
export async function individualEnrollmentAccess(db: SupabaseClient<Database>, studentId: string) {
  const flag = await db
    .from('enrollment_rule_flags')
    .select('enabled,implemented')
    .eq('key', 'enrollment_access')
    .single();
  if (flag.error) throwStudentScheduleError(flag.error);
  if (!flag.data.enabled || !flag.data.implemented)
    return { active: false, serverNow: new Date().toISOString(), enrollments: [] };
  const result = await db.rpc('student_enrollment_access_v2', { p_student: studentId });
  if (result.error) throwStudentScheduleError(result.error);
  return result.data;
}
