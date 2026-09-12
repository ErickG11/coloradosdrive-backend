import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { Role, UserSummary } from '../models/user.model';

type UserRow = Database['public']['Tables']['users']['Row'];

function toUserSummary(row: Pick<UserRow, 'id' | 'nombre_completo'>): UserSummary {
  return {
    id: row.id,
    nombreCompleto: row.nombre_completo,
  };
}

// Recibe el cliente de Supabase por constructor para poder mockearlo en tests.
export class UserService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listByRole(rol: Role): Promise<UserSummary[]> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, nombre_completo')
      .eq('rol', rol)
      .order('nombre_completo');

    if (error) {
      throw error;
    }

    return data.map(toUserSummary);
  }
}
