import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { cohortError } from '../config/cohortErrors';
export async function planEndHour(db: SupabaseClient<Database>): Promise<number> {
  const r = await db.from('app_settings').select('practicas_hora_fin').eq('id', true).maybeSingle();
  if (r.error) throw cohortError('PLAN_CONFIG_NO_DISPONIBLE');
  return r.data?.practicas_hora_fin ?? 22;
}
