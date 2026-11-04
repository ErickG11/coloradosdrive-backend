import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import {
  BLOQUEO_SPAM_DIAS,
  MOTIVOS_RECHAZO,
  type MotivoRechazo,
} from '../config/enrollmentCatalog';
import { env } from '../config/env';
import { enrollmentRateKey } from '../utils/enrollmentRateKey';
import { validateEnrollmentDecision } from '../utils/enrollmentValidation';
import { logSolicitudFailure } from '../utils/solicitudLog';
import { normalizeSolicitudError, solicitudError } from '../utils/solicitudError';
import type { EmailService } from './email.service';
import { AccountService } from './account.service';
import { CohortAssignmentService } from './cohortAssignment.service';
import { SolicitudApprovalService } from './solicitudApproval.service';

export interface DecisionResult {
  id: string;
  estado: 'devuelta' | 'rechazada' | 'aprobada';
  studentId: string | null;
  etapa?: 'por_agendar';
  cohorte?: { id: string; nombre: string } | null;
  pendienteCohorte?: boolean;
  correoEnviado?: boolean;
}

// Decisión del admin sobre una solicitud enviada. Cada transición es una función SQL atómica; el
// correo sale después y su fallo nunca deshace la decisión.
export class SolicitudDecisionService {
  private readonly approval: SolicitudApprovalService;

  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly email: EmailService,
  ) {
    this.approval = new SolicitudApprovalService(
      db,
      email,
      new AccountService(db),
      new CohortAssignmentService(db),
    );
  }

  async decidir(id: string, actor: string, input: unknown): Promise<DecisionResult> {
    const decision = validateEnrollmentDecision(input);
    if (decision.accion === 'aprobar') return this.aprobar(id, actor);
    if (decision.motivoCodigo === null || decision.mensaje === null)
      throw solicitudError('Selecciona un motivo válido.', 400, 'MOTIVO_INVALIDO');
    return decision.accion === 'devolver'
      ? this.devolver(id, actor, decision.motivoCodigo, decision.mensaje, decision.notaInterna)
      : this.rechazar(
          id,
          actor,
          decision.motivoCodigo as Exclude<MotivoRechazo, 'VENCIDA'>,
          decision.mensaje,
          decision.notaInterna,
        );
  }

  private async devolver(
    id: string,
    actor: string,
    motivo: string,
    mensaje: string,
    nota: string | null,
  ): Promise<DecisionResult> {
    const { data, error } = await this.db.rpc('devolver_solicitud_inscripcion', {
      p_id: id,
      p_actor: actor,
      p_motivo: motivo,
      p_mensaje: mensaje,
      p_nota: nota === '' ? null : nota,
    });
    if (error) throw normalizeSolicitudError(error);
    if (!data) throw solicitudError('No se pudo devolver.', 503, 'SERVICIO_NO_DISPONIBLE');
    let correoEnviado = true;
    try {
      await this.email.sendApplicationReturnedEmail({ to: data.correo });
    } catch {
      correoEnviado = false;
      logSolicitudFailure('return_email_failed');
    }
    return { id, estado: 'devuelta', studentId: null, correoEnviado };
  }

  private async rechazar(
    id: string,
    actor: string,
    motivo: Exclude<MotivoRechazo, 'VENCIDA'>,
    mensaje: string,
    nota: string | null,
  ): Promise<DecisionResult> {
    // El hash del correo se calcula antes de bloquear la fila; el correo de una solicitud no cambia.
    let bloqueoHash: string | null = null;
    if (motivo === 'SPAM') {
      const { data: s, error } = await this.db
        .from('solicitudes_inscripcion')
        .select('correo')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!s) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
      bloqueoHash = enrollmentRateKey('correo', s.correo, env.ENROLLMENT_RATE_HMAC_SECRET);
    }
    const { data, error } = await this.db.rpc('rechazar_solicitud_inscripcion', {
      p_id: id,
      p_actor: actor,
      p_motivo: motivo,
      p_mensaje: mensaje,
      p_nota: nota === '' ? null : nota,
      p_bloqueo_hash: bloqueoHash,
      p_bloqueo_dias: motivo === 'SPAM' ? BLOQUEO_SPAM_DIAS : null,
    });
    if (error) throw normalizeSolicitudError(error);
    if (!data) throw solicitudError('No se pudo rechazar.', 503, 'SERVICIO_NO_DISPONIBLE');
    const result: DecisionResult = { id, estado: 'rechazada', studentId: null };
    // DATOS_INCONSISTENTES_O_FALSOS y SPAM no envían correo.
    if (MOTIVOS_RECHAZO[motivo].enviarCorreo) {
      try {
        await this.email.sendApplicationRejectedEmail({ to: data.correo, motivo: mensaje });
        result.correoEnviado = true;
      } catch {
        result.correoEnviado = false;
        logSolicitudFailure('rejection_email_failed');
      }
    }
    return result;
  }

  private async aprobar(id: string, actor: string): Promise<DecisionResult> {
    const r = await this.approval.aprobar(id, actor);
    return {
      id,
      estado: 'aprobada',
      studentId: r.studentId,
      etapa: r.etapa,
      cohorte: r.cohorte,
      pendienteCohorte: r.pendienteCohorte,
      correoEnviado: r.correoEnviado,
    };
  }
}
