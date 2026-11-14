import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { EnrollmentRuleKey } from '../models/enrollmentFoundation.model';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
export async function enrollmentRuleEnabled(
  db: SupabaseClient<Database>,
  key: EnrollmentRuleKey,
): Promise<boolean> {
  const result = await db
    .from('enrollment_rule_flags')
    .select('enabled,implemented')
    .eq('key', key)
    .single();
  if (result.error) throwStudentScheduleError(result.error);
  return result.data.enabled && result.data.implemented;
}
