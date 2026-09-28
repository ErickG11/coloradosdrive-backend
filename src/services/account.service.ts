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

  async eliminarCuenta(userId: string): Promise<void> {
    await this.supabase.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}
