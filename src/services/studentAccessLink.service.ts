import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import { solicitudError } from '../utils/solicitudError';
import { logSolicitudFailure } from '../utils/solicitudLog';
import type { AccountService } from './account.service';
import type { EmailService } from './email.service';
import { recordSolicitudAudit } from './solicitudAudit.service';

const COOLDOWN_SECONDS = 60;

// Reenvío del enlace de un solo uso para crear la contraseña. Solo para alumnos que entraron por
// una solicitud aprobada; cada reenvío queda auditado (sin datos personales) y hay una espera
// mínima entre reenvíos del mismo alumno.
export class StudentAccessLinkService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly email: EmailService,
    private readonly accounts: AccountService,
  ) {}

  async reenviar(actor: string, studentId: string): Promise<{ correoEnviado: boolean }> {
    const { data: s, error } = await this.db
      .from('solicitudes_inscripcion')
      .select('id,correo')
      .eq('student_id', studentId)
      .eq('estado', 'aprobada')
      .maybeSingle();
    if (error) throw error;
    if (!s)
      throw solicitudError('El alumno no proviene de una solicitud aprobada', 404, 'NO_ENCONTRADO');
    const user = await this.db
      .from('users')
      .select('nombre_completo,activo')
      .eq('id', studentId)
      .eq('rol', 'estudiante')
      .maybeSingle();
    if (user.error) throw user.error;
    if (!user.data) throw solicitudError('Alumno no encontrado', 404, 'NO_ENCONTRADO');
    if (!user.data.activo)
      throw solicitudError('El alumno está desactivado', 409, 'ESTADO_INCORRECTO');

    const since = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString();
    const recent = await this.db
      .from('solicitud_auditoria')
      .select('id')
      .eq('solicitud_id', s.id)
      .eq('accion', 'enlace_acceso_reenviado')
      .gte('creado_at', since)
      .limit(1);
    if (recent.error) throw recent.error;
    if (recent.data.length > 0)
      throw solicitudError(
        'Espera un minuto antes de reenviar el enlace.',
        429,
        'LIMITE_PETICIONES',
      );

    await recordSolicitudAudit(this.db, s.id, actor, 'enlace_acceso_reenviado');
    try {
      const link = await this.accounts.generarEnlaceAcceso(s.correo);
      await this.email.sendAccessLinkEmail({
        to: s.correo,
        nombreCompleto: user.data.nombre_completo,
        tokenHash: link.tokenHash,
        type: link.type,
        reenvio: true,
      });
      return { correoEnviado: true };
    } catch {
      logSolicitudFailure('approval_email_failed');
      return { correoEnviado: false };
    }
  }
}
