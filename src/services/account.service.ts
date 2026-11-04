import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import { AppError } from '../utils/AppError';

const AUTH_EMAIL_EXISTS = 'email_exists';

export interface AccountWithTemporaryPassword {
  userId: string;
  temporaryPassword: string;
}

// Crea la cuenta de Supabase Auth de un estudiante con una contraseña
// temporal de un solo uso. Solo toca Auth: la fila en `users` y el resto
// de pasos los hace quien lo llama. (EnrollmentService, Sprint 2, todavía
// tiene su propia copia de esta lógica; se unifica en el módulo de
// matriculación manual.)
export class AccountService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async crearCuentaConClaveTemporal(correo: string): Promise<AccountWithTemporaryPassword> {
    // 12 bytes -> 16 caracteres en base64url: entropía suficiente para una
    // contraseña temporal.
    const temporaryPassword = randomBytes(12).toString('base64url');

    const { data, error } = await this.supabase.auth.admin.createUser({
      email: correo,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { role: 'estudiante' },
    });

    if (error) {
      if (error.code === AUTH_EMAIL_EXISTS) {
        throw new AppError('Ya existe un usuario registrado con este correo electrónico', 409);
      }
      throw error;
    }

    return { userId: data.user.id, temporaryPassword };
  }

  // Cuenta de inscripción en línea: correo confirmado, sin contraseña. La persona crea la suya
  // con un enlace de un solo uso (generarEnlaceAcceso).
  async crearCuentaSinContrasena(correo: string): Promise<string> {
    const { data, error } = await this.supabase.auth.admin.createUser({
      email: correo,
      email_confirm: true,
      app_metadata: { role: 'estudiante' },
    });
    if (error) {
      if (error.code === AUTH_EMAIL_EXISTS) {
        throw new AppError('Ya existe un usuario registrado con este correo electrónico', 409, {
          code: 'CUENTA_YA_EXISTE',
        });
      }
      throw error;
    }
    return data.user.id;
  }

  // Solo se devuelve el hash del token: el action_link nunca se usa ni se registra.
  async generarEnlaceAcceso(correo: string): Promise<{ tokenHash: string; type: 'recovery' }> {
    const { data, error } = await this.supabase.auth.admin.generateLink({
      type: 'recovery',
      email: correo,
    });
    if (error || !data.properties.hashed_token) {
      throw new AppError('No se pudo generar el enlace de acceso', 502, {
        code: 'SERVICIO_NO_DISPONIBLE',
      });
    }
    return { tokenHash: data.properties.hashed_token, type: 'recovery' };
  }

  async eliminarCuenta(userId: string): Promise<void> {
    await this.supabase.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}
