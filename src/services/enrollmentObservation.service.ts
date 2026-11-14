import { supabaseAdmin } from '../config/supabase';
import { logSafeError } from '../utils/safeLog';
export async function heartbeat(
  job: string,
  result: 'started' | 'ok' | 'failed',
  disabled = false,
): Promise<void> {
  const r = await supabaseAdmin.rpc('enrollment_job_heartbeat_v2', {
    p_job: job,
    p_result: result,
    p_disabled: disabled,
  });
  if (r.error) logSafeError('enrollment_heartbeat_failed', r.error);
}
export async function observeJob<T>(job: string, run: () => Promise<T>): Promise<T> {
  await heartbeat(job, 'started');
  try {
    const result = await run();
    const report = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
    const failed = ['failed', 'fallos', 'errors'].some(
      (key) => typeof report[key] === 'number' && report[key] > 0,
    );
    await heartbeat(job, failed ? 'failed' : 'ok');
    return result;
  } catch (error) {
    await heartbeat(job, 'failed');
    throw error;
  }
}
export async function monitorEnrollmentRules(): Promise<void> {
  const r = await supabaseAdmin.rpc('monitor_enrollment_rules_v2', {});
  if (r.error) throw r.error;
}
