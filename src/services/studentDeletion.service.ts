import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { AppError } from '../utils/AppError';

export interface StudentDeletionOperation extends Record<string, unknown> {
  student_id: string;
  actor_id: string;
  confirmed_at: string;
  phase: 'bloqueo' | 'storage' | 'auth' | 'completo';
  status: 'pendiente' | 'fallido' | 'completo';
  last_retry_actor_id: string | null;
  last_retry_at: string | null;
  retry_count: number;
  data_deleted_by: string | null;
  data_deleted_at: string | null;
  updated_at: string;
}
interface ProviderError {
  status?: number;
  statusCode?: number | string;
  code?: string;
}
function missing(error: unknown): boolean {
  const e = error as ProviderError | null | undefined;
  return Number(e?.status ?? e?.statusCode) === 404 || e?.code === 'user_not_found';
}
class DeletionFailure extends Error {
  constructor(
    readonly safeCode: string,
    readonly transient: boolean,
  ) {
    super(safeCode);
  }
}
function failure(error: unknown, code: string): DeletionFailure {
  const e = error as ProviderError | null | undefined;
  const status = Number(e?.status ?? e?.statusCode ?? 0);
  const retry =
    status >= 500 ||
    status === 429 ||
    (!status &&
      (!e?.code || ['57014', '40P01', '55P03', '08006', 'CD032', 'PGRST003'].includes(e.code)));
  return new DeletionFailure(code, retry);
}

// Comprobación previa a Auth; los triggers de 026 cierran la carrera SQL.
export async function assertStudentMutable(
  db: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { data, error } = await db
    .from('student_deletion_operations')
    .select('student_id,status')
    .eq('student_id', id)
    .maybeSingle();
  if (error)
    throw new AppError('No se pudo verificar el estado del alumno', 503, { code: 'UNCONFIRMED' });
  if (data && data.status !== 'completo')
    throw new AppError('El alumno tiene una eliminación pendiente', 409, {
      code: 'DELETION_PENDING',
    });
}

export class StudentDeletionService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  private log(actor: string, op: StudentDeletionOperation, event: string, code?: string): void {
    console.error(
      JSON.stringify({
        event,
        student_id: op.student_id,
        actor_id: actor,
        phase: op.phase,
        ...(code ? { code } : {}),
      }),
    );
  }
  private async checked<T>(
    request: PromiseLike<{ data: T | null; error: unknown }>,
    code: string,
  ): Promise<T> {
    try {
      const r = await request;
      if (r.error) throw failure(r.error, code);
      if (r.data === null) throw new DeletionFailure(code, true);
      return r.data;
    } catch (e) {
      throw e instanceof DeletionFailure ? e : failure(e, code);
    }
  }
  private async current(id: string): Promise<StudentDeletionOperation> {
    return this.checked(
      this.db.from('student_deletion_operations').select().eq('student_id', id).single(),
      'OPERATION_READ_FAILED',
    );
  }
  private async advance(
    actor: string,
    op: StudentDeletionOperation,
    next: 'storage' | 'completo' | 'fallido',
  ): Promise<StudentDeletionOperation> {
    return this.checked(
      this.db.rpc('advance_student_deletion', {
        p_actor: actor,
        p_student: op.student_id,
        p_phase: op.phase,
        p_version: op.updated_at,
        p_next: next,
      }),
      'PHASE_WRITE_FAILED',
    );
  }
  async list(
    page: number,
    pageSize: number,
    status?: 'pendiente' | 'fallido',
  ): Promise<{ items: StudentDeletionOperation[]; total: number; page: number; pageSize: number }> {
    try {
      const { data, error, count } = await this.db
        .from('student_deletion_operations')
        .select('*', { count: 'exact' })
        .in('status', status ? [status] : ['pendiente', 'fallido'])
        .order('updated_at', { ascending: false })
        .order('student_id')
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (error) throw new Error('unconfirmed');
      return { items: data, total: count ?? 0, page, pageSize };
    } catch {
      throw new AppError('No se pudieron consultar las eliminaciones', 503, {
        code: 'UNCONFIRMED',
      });
    }
  }
  async remove(
    actor: string,
    studentId: string,
    confirmation?: string,
  ): Promise<StudentDeletionOperation> {
    let op: StudentDeletionOperation;
    try {
      const r = await this.db.rpc('begin_student_deletion', {
        p_actor: actor,
        p_student: studentId,
        p_confirmation: confirmation ?? null,
      });
      if (r.error) {
        if (r.error.code === 'CD031')
          throw new AppError('La cédula de confirmación no coincide', 400, {
            code: 'INVALID_CONFIRMATION',
          });
        if (r.error.code === 'CD404')
          throw new AppError('Alumno u operación no encontrados', 404, {
            code: 'STUDENT_NOT_FOUND',
          });
        if (r.error.code === '42501') throw new AppError('Se requiere administrador', 403);
        throw new Error('unconfirmed');
      }
      op = r.data;
    } catch (e) {
      if (e instanceof AppError) throw e;
      // No sabemos si se creó la confirmación: no iniciar efectos ni repetirla.
      console.error(
        JSON.stringify({
          event: 'student_deletion_begin_unconfirmed',
          student_id: studentId,
          actor_id: actor,
        }),
      );
      throw new AppError(
        'No se pudo confirmar el inicio; consulta las eliminaciones pendientes',
        503,
        { code: 'UNCONFIRMED' },
      );
    }
    if (op.status === 'completo') return op;
    this.log(actor, op, op.retry_count ? 'student_deletion_retry' : 'student_deletion_started');
    let retried = false;
    // Límite de pasos ante peticiones concurrentes; no hay bucle de fondo.
    for (let step = 0; step < 8; step++) {
      try {
        const previousPhase = op.phase;
        if (op.phase === 'bloqueo') {
          const r = await this.db.auth.admin.updateUserById(studentId, { ban_duration: '876000h' });
          if (r.error && !missing(r.error)) throw failure(r.error, 'AUTH_BAN_FAILED');
          op = await this.advance(actor, op, 'storage');
        } else if (op.phase === 'storage') {
          const paths = await this.checked(
            this.db.rpc('student_deletion_storage_paths', { p_actor: actor, p_student: studentId }),
            'STORAGE_PATHS_FAILED',
          );
          // Sin manifiesto: las rutas viven en sus filas hasta confirmar la transacción.
          for (const path of paths) {
            const r = await this.db.storage.from('solicitudes-documentos').remove([path]);
            if (r.error && !missing(r.error)) throw failure(r.error, 'STORAGE_REMOVE_FAILED');
          }
          op = await this.checked(
            this.db.rpc('delete_student_data', {
              p_actor: actor,
              p_student: studentId,
              p_version: op.updated_at,
              p_cleaned_paths: paths,
            }),
            'DATA_DELETE_FAILED',
          );
        } else if (op.phase === 'auth') {
          const r = await this.db.auth.admin.deleteUser(studentId);
          if (r.error && !missing(r.error)) throw failure(r.error, 'AUTH_DELETE_FAILED');
          op = await this.advance(actor, op, 'completo');
        }
        if (op.status === 'completo') return op;
        if (op.phase === previousPhase) {
          // CAS perdió contra otro admin: repetir el efecto también consume
          // el único reintento, aunque no haya habido error de transporte.
          if (retried) throw new DeletionFailure('PHASE_CONTENDED', false);
          retried = true;
        }
      } catch (error) {
        const e = error instanceof DeletionFailure ? error : failure(error, 'PROVIDER_UNCONFIRMED');
        this.log(actor, op, 'student_deletion_step_failed', e.safeCode);
        if (e.transient && !retried) {
          retried = true;
          // Releer antes de repetir: un timeout no demuestra rollback.
          try {
            op = await this.current(studentId);
            if (op.status === 'completo') return op;
            continue;
          } catch {
            /* conservar fase durable */
          }
        }
        try {
          op = await this.advance(actor, op, 'fallido');
          if (op.status === 'completo') return op;
        } catch {
          /* puede quedar pendiente */
        }
        throw new AppError('Eliminación pendiente; consulta su fase y pulsa reintentar', 503, {
          code: 'DELETION_INCOMPLETE',
        });
      }
    }
    throw new AppError('Eliminación en curso; consulta su estado antes de reintentar', 503, {
      code: 'DELETION_INCOMPLETE',
    });
  }
}
