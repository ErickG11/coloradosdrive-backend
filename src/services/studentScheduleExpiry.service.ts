import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
type Db = SupabaseClient<Database>;

export async function expireStudentSchedule(db: Db, studentId: string): Promise<number> {
  const result = await db.rpc('expire_student_reservations', { p_student: studentId });
  if (result.error) throwStudentScheduleError(result.error);
  return result.data;
}

export class StudentScheduleExpiryService {
  constructor(private readonly db: Db) {}
  async run(): Promise<{ vencidas: number; fallos: number; revisadas: number }> {
    // El reloj SQL decide si venció, incluso con diferencia de reloj en Node.
    // Revisar las primeras100 leases incluye todas las vencidas antes de las futuras.
    const flag = await this.db
      .from('enrollment_rule_flags')
      .select('enabled,implemented')
      .eq('key', 'reservations')
      .single();
    if (flag.error) throwStudentScheduleError(flag.error);
    const result = await this.db
      .from('student_schedule_reservations')
      .select('student_id')
      .in(
        'estado',
        flag.data.enabled && flag.data.implemented ? ['vigente'] : ['vigente', 'pago_en_curso'],
      )
      .order('expira_at')
      .order('id')
      .limit(100);
    if (result.error) throwStudentScheduleError(result.error);
    const students = [...new Set(result.data.map((r) => r.student_id))];
    const report = { vencidas: 0, fallos: 0, revisadas: students.length };
    // Concurrencia acotada entre alumnos distintos; la RPC serializa a cada alumno.
    for (let i = 0; i < students.length; i += 5) {
      const results = await Promise.allSettled(
        students.slice(i, i + 5).map((id) => expireStudentSchedule(this.db, id)),
      );
      for (const row of results) {
        if (row.status === 'fulfilled') report.vencidas += row.value;
        else report.fallos++;
      }
    }
    return report;
  }
}
