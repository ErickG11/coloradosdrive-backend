import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { AppError } from '../utils/AppError';
import { assertStudentMutable } from './studentDeletion.service';

export interface PracticeRecovery extends Record<string, unknown> {
  slotId: string;
  status: string;
  reason?: string | null;
}
type RecoveryRow = Database['public']['Tables']['student_practice_recovery']['Row'];
export interface StudentAccessResult {
  id: string;
  activo: boolean;
  reservas: PracticeRecovery[];
  recuperacionPendiente: boolean;
}
export class StudentAccessService {
  constructor(private readonly db: SupabaseClient<Database>) {}

  private async student(id: string): Promise<void> {
    const { data, error } = await this.db
      .from('users')
      .select('id')
      .eq('id', id)
      .eq('rol', 'estudiante')
      .maybeSingle();
    if (error) throw new AppError('No se pudo consultar el alumno', 503);
    if (!data) throw new AppError('Alumno no encontrado', 404);
  }
  async reservations(id: string): Promise<RecoveryRow[]> {
    await this.student(id);
    const { data, error } = await this.db
      .from('student_practice_recovery')
      .select()
      .eq('student_id', id)
      .in('status', ['cancelada_por_desactivacion', 'pendiente_reprogramar'])
      .order('scheduled_at')
      .order('slot_id');
    if (error) throw new AppError('No se pudieron consultar las reservas por recuperar', 503);
    return data;
  }
  private async authBan(id: string, active: boolean): Promise<void> {
    try {
      const { error } = await this.db.auth.admin.updateUserById(id, {
        ban_duration: active ? 'none' : '876000h',
      });
      if (error) throw new Error('unconfirmed');
    } catch {
      console.error(
        JSON.stringify({ event: 'student_access_auth_unconfirmed', student_id: id, active }),
      );
      throw new AppError(
        'El acceso requiere revisión administrativa; reintenta la misma acción',
        503,
        { code: 'UNCONFIRMED' },
      );
    }
  }
  async setActive(actor: string, id: string, active: boolean): Promise<StudentAccessResult> {
    if (active) await assertStudentMutable(this.db, id);
    await this.student(id);
    // Al desactivar cierra primero HTTP; al reactivar, quita primero el ban.
    if (active) {
      await this.authBan(id, true);
      try {
        await assertStudentMutable(this.db, id);
      } catch (error) {
        // D pudo comenzar durante el unban: cerrar de nuevo, nunca reactivar.
        await this.authBan(id, false);
        throw error;
      }
    }
    try {
      const { error } = await this.db.rpc('set_student_active', {
        p_actor: actor,
        p_student: id,
        p_active: active,
      });
      if (error) {
        if (active && error.code === 'CD030') {
          await this.authBan(id, false);
          throw new AppError('El alumno tiene una eliminación pendiente', 409, {
            code: 'DELETION_PENDING',
          });
        }
        throw new Error('unconfirmed');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error(
        JSON.stringify({ event: 'student_access_sql_unconfirmed', student_id: id, active }),
      );
      throw new AppError(
        'No se pudo confirmar el cambio de acceso; revisa el estado antes de reintentar',
        503,
        { code: 'UNCONFIRMED' },
      );
    }
    if (!active) await this.authBan(id, false);
    const results: PracticeRecovery[] = [];
    let recoveryUnconfirmed = false;
    if (active) {
      try {
        const pending = await this.reservations(id);
        for (const row of pending) {
          try {
            const result = await this.db.rpc('restore_student_practice', {
              p_actor: actor,
              p_student: id,
              p_slot: row.slot_id,
            });
            if (result.error) throw new Error('unconfirmed');
            results.push(result.data);
          } catch {
            recoveryUnconfirmed = true;
            results.push({
              slotId: row.slot_id,
              status: 'no_confirmada',
              reason: 'reintentar_recuperacion',
            });
          }
        }
      } catch {
        recoveryUnconfirmed = true;
      }
    }
    return { id, activo: active, reservas: results, recuperacionPendiente: recoveryUnconfirmed };
  }
}
