import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import { AppError } from '../utils/AppError';
import { PracticeSlotService } from './practiceSlot.service';
import type { EmailService } from './email.service';

type UserRow = Database['public']['Tables']['users']['Row'];

function temporaryPassword(): string {
  return randomBytes(18).toString('base64url');
}

export interface InstructorInput {
  cedula: string;
  nombreCompleto: string;
  telefono: string;
  correo: string;
}

export interface InstructorListQuery {
  q?: string;
  activo?: boolean;
  page: number;
  pageSize: number;
}

export interface InstructorSummary {
  id: string;
  cedula: string;
  nombreCompleto: string;
  telefono: string | null;
  activo: boolean;
  createdAt: string;
}

export interface InstructorDetail extends InstructorSummary { correo: string }

export interface InstructorOwn {
  profile: InstructorDetail;
  practiceSlots: {
    id: string;
    cohortId: string;
    scheduledAt: string;
    durationMinutes: number;
    status: Database['public']['Tables']['practice_slots']['Row']['status'];
    studentName: string | null;
  }[];
}

function summary(row: Pick<UserRow,
  'id' | 'cedula' | 'nombre_completo' | 'telefono' | 'activo' | 'created_at'>): InstructorSummary {
  return {
    id: row.id,
    cedula: row.cedula,
    nombreCompleto: row.nombre_completo,
    telefono: row.telefono,
    activo: row.activo,
    createdAt: row.created_at,
  };
}

export class InstructorService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly email: EmailService,
  ) {}

  async create(input: InstructorInput): Promise<InstructorDetail> {
    const { data: existing, error: lookupError } = await this.db
      .from('users').select('id').eq('cedula', input.cedula).maybeSingle();
    if (lookupError) throw new AppError('No se pudo verificar la cédula', 500);
    if (existing) throw new AppError('La cédula ya está registrada', 409);

    const generatedPassword = temporaryPassword();
    let authResult: Awaited<ReturnType<typeof this.db.auth.admin.createUser>>;
    try {
      authResult = await this.db.auth.admin.createUser({
        email: input.correo,
        password: generatedPassword,
        email_confirm: true,
        app_metadata: { role: 'instructor' },
      });
    } catch {
      throw new AppError('No se pudo confirmar la creación en Auth; requiere revisión antes de reintentar', 503);
    }
    const { data: auth, error: authError } = authResult;
    if (authError) {
      if (authError.code === 'email_exists') throw new AppError('El correo ya está registrado', 409);
      if (!authError.status || authError.status >= 500)
        throw new AppError('La creación en Auth tiene resultado incierto; requiere revisión antes de reintentar', 503);
      throw new AppError('No se pudo crear la cuenta de acceso', 502);
    }

    try {
      const { data: row, error } = await this.db.from('users').insert({
        id: auth.user.id,
        cedula: input.cedula,
        nombre_completo: input.nombreCompleto,
        telefono: input.telefono,
        rol: 'instructor',
        activo: true,
        debe_cambiar_password: true,
      }).select().single();
      if (error) {
        if (error.code === '23505') throw new AppError('La cédula ya está registrada', 409);
        throw new AppError('No se pudo guardar el instructor', 500);
      }
      await this.email.sendInstructorCredentials({
        to: input.correo, nombreCompleto: input.nombreCompleto, temporaryPassword: generatedPassword,
      });
      return { ...summary(row), correo: input.correo };
    } catch (error) {
      try {
        const { error: deleteError } = await this.db.auth.admin.deleteUser(auth.user.id);
        if (deleteError) throw deleteError;
      } catch {
        throw new AppError('La cuenta requiere reconciliación administrativa', 503);
      }
      if (error instanceof AppError) throw error;
      throw new AppError('No se pudo enviar el correo de acceso', 502);
    }
  }

  async list({ q, activo, page, pageSize }: InstructorListQuery): Promise<{
    items: InstructorSummary[]; total: number; page: number; pageSize: number;
  }> {
    let query = this.db.from('users')
      .select('id,cedula,nombre_completo,telefono,activo,created_at', { count: 'exact' })
      .eq('rol', 'instructor');
    if (q) query = query.or(`nombre_completo.ilike.%${q}%,cedula.ilike.%${q}%`);
    if (activo !== undefined) query = query.eq('activo', activo);
    const { data, error, count } = await query
      .order('nombre_completo')
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new AppError('No se pudieron listar los instructores', 500);
    return { items: data.map(summary), total: count ?? 0, page, pageSize };
  }

  private async row(id: string): Promise<UserRow> {
    const { data, error } = await this.db.from('users').select().eq('id', id)
      .eq('rol', 'instructor').maybeSingle();
    if (error) throw new AppError('No se pudo consultar el instructor', 500);
    if (!data) throw new AppError('Instructor no encontrado', 404);
    return data;
  }

  async get(id: string): Promise<InstructorDetail> {
    const row = await this.row(id);
    const { data, error } = await this.db.auth.admin.getUserById(id);
    if (error || !data.user.email) throw new AppError('No se pudo consultar el correo', 503);
    return { ...summary(row), correo: data.user.email };
  }

  async update(id: string, fields: { nombreCompleto?: string; telefono?: string }): Promise<InstructorDetail> {
    await this.row(id);
    const update: Database['public']['Tables']['users']['Update'] = {};
    if (fields.nombreCompleto !== undefined) update.nombre_completo = fields.nombreCompleto;
    if (fields.telefono !== undefined) update.telefono = fields.telefono;
    const { error } = await this.db.from('users').update(update).eq('id', id).eq('rol', 'instructor');
    if (error) throw new AppError('No se pudo actualizar el instructor', 500);
    return this.get(id);
  }

  async setActive(id: string, active: boolean): Promise<InstructorDetail> {
    await this.row(id);
    // Al reactivar se retira primero el ban: si falla, el middleware sigue
    // bloqueando la cuenta. Al desactivar, la BD se cierra primero.
    if (active) await this.setAuthBan(id, false);
    const { data, error } = await this.db.rpc('set_instructor_active', {
      p_id: id, p_active: active,
    });
    if (error?.code === 'CD024')
      throw new AppError('El instructor tiene franjas futuras asignadas o confirmadas', 409);
    if (error) throw new AppError('No se pudo cambiar el estado del instructor', 500);
    if (!data) throw new AppError('Instructor no encontrado', 404);
    if (!active) await this.setAuthBan(id, true);
    return this.get(id);
  }

  private async setAuthBan(id: string, banned: boolean): Promise<void> {
    const { error } = await this.db.auth.admin.updateUserById(id, {
      ban_duration: banned ? '876000h' : 'none',
    });
    if (error) throw new AppError('El estado de acceso requiere reconciliación administrativa', 503);
  }

  async resendCredentials(id: string): Promise<void> {
    const row = await this.row(id);
    if (!row.debe_cambiar_password)
      throw new AppError('El instructor ya cambió su contraseña temporal', 409);
    const { data, error } = await this.db.auth.admin.getUserById(id);
    if (error || !data.user.email) throw new AppError('No se pudo consultar el correo', 503);
    const temporaryPassword = randomBytes(18).toString('base64url');
    const { error: updateError } = await this.db.auth.admin.updateUserById(id, {
      password: temporaryPassword,
    });
    if (updateError) throw new AppError('No se pudo regenerar la contraseña temporal', 502);
    const { error: flagError } = await this.db.from('users')
      .update({ debe_cambiar_password: true }).eq('id', id).eq('rol', 'instructor');
    if (flagError) throw new AppError('El estado de la contraseña requiere reconciliación administrativa', 503);
    try {
      await this.email.sendInstructorCredentials({
        to: data.user.email, nombreCompleto: row.nombre_completo, temporaryPassword,
      });
    } catch {
      throw new AppError('No se pudo enviar el correo de acceso; puedes reintentarlo', 502);
    }
  }

  async resetPassword(id: string, adminId: string): Promise<void> {
    const row = await this.row(id);
    if (!row.activo) throw new AppError('El instructor está inactivo', 409);
    const { data, error } = await this.db.auth.admin.getUserById(id);
    if (error || !data.user.email) throw new AppError('No se pudo consultar el correo', 503);

    const generatedPassword = temporaryPassword();
    let authResult: Awaited<ReturnType<typeof this.db.auth.admin.updateUserById>>;
    try {
      authResult = await this.db.auth.admin.updateUserById(id, {
        password: generatedPassword,
      });
    } catch {
      // Un corte de red puede ocurrir después de que Auth aplique el cambio.
      throw new AppError('El resultado del restablecimiento en Auth es incierto; reintenta', 503);
    }
    if (authResult.error) throw new AppError('No se pudo restablecer la contraseña en Auth', 502);

    const { error: flagError } = await this.db.from('users')
      .update({ debe_cambiar_password: true }).eq('id', id).eq('rol', 'instructor');
    if (flagError) {
      // Auth y public.users no comparten transacción. No enviamos una clave
      // sin bloqueo de acceso; el administrador debe reintentar o reconciliar.
      throw new AppError('La contraseña cambió en Auth, pero el estado requiere reconciliación; reintenta', 503);
    }

    try {
      await this.email.sendInstructorCredentials({
        to: data.user.email, nombreCompleto: row.nombre_completo,
        temporaryPassword: generatedPassword, reason: 'admin_reset',
      });
    } catch {
      // El reintento genera una clave nueva y reemplaza esta; jamás se expone.
      throw new AppError('La contraseña cambió, pero el correo no se envió; reintenta para generar una nueva clave', 502);
    }
    console.warn(JSON.stringify({ adminId, instructorId: id, fecha: new Date().toISOString() }));
  }

  async own(id: string): Promise<InstructorOwn> {
    const profile = await this.get(id);
    const slots = await new PracticeSlotService(this.db).listSlotsForInstructor(id);
    return {
      profile,
      practiceSlots: slots.map((slot) => ({
        id: slot.id,
        cohortId: slot.cohortId,
        scheduledAt: slot.scheduledAt,
        durationMinutes: slot.durationMinutes,
        status: slot.status,
        studentName: slot.studentName,
      })),
    };
  }
}
