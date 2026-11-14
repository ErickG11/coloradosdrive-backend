import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '../config/privacy';
import {
  latestVerification,
  verificationEnablesApproval,
  type VerificationContext,
} from '../utils/enrollmentVerification';
import { normalizeSolicitudError, solicitudError } from '../utils/solicitudError';
import { SolicitudApprovalRecoveryService } from './solicitudApprovalRecovery.service';
import { logSolicitudFailure } from '../utils/solicitudLog';
import type { AccountService } from './account.service';
import type { CohortAssignmentService } from './cohortAssignment.service';
import type { EmailService } from './email.service';

export interface ApprovalResult {
  studentId: string;
  cohorte: { id: string; nombre: string } | null;
  pendienteCohorte: boolean;
  correoEnviado: boolean;
  etapa: 'por_agendar';
}

// Resultado desconocido: no se compensa para no borrar una cuenta que pudo quedar aprobada.
class UncertainApproval extends Error {
  constructor(readonly inner: Error) {
    super('approval_unconfirmed');
  }
}

export interface ApprovalVerifications {
  identidad: string;
  estudios: string;
}

// Requisitos de aprobar una solicitud enviada. Los métodos válidos salen de enrollmentCatalog.ts;
// la base de datos vuelve a comprobar, con la solicitud bloqueada, que esas verificaciones siguen
// siendo las más recientes y vigentes (validar_aprobacion_inscripcion).
export class SolicitudApprovalService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly email: EmailService,
    private readonly accounts: AccountService,
    _cohorts: CohortAssignmentService,
  ) {}

  async aprobar(id: string, actor: string): Promise<ApprovalResult> {
    const ids = await this.validarRequisitos(id);
    const claimed = await this.db.rpc('reclamar_aprobacion_inscripcion', {
      p_id: id,
      p_actor: actor,
      p_verif_identidad: ids.identidad,
      p_verif_estudios: ids.estudios,
      p_version_aviso: PRIVACY_NOTICE_VERSION,
      p_version_terminos: TERMS_VERSION,
    });
    if (claimed.error) throw normalizeSolicitudError(claimed.error);
    if (!claimed.data) throw solicitudError('No se pudo aprobar.', 503, 'SERVICIO_NO_DISPONIBLE');
    const { claim, correo, authUserId } = claimed.data;
    if (!authUserId)
      throw solicitudError(
        'Se requiere la migración055 para aprobar.',
        503,
        'SERVICIO_NO_DISPONIBLE',
      );

    let studentId: string | null = null;
    try {
      studentId = await this.accounts.crearCuentaSinContrasena(correo, {
        id: authUserId,
        solicitudId: id,
      });
      await this.finalizar(id, actor, claim, studentId);
    } catch (err) {
      if (err instanceof UncertainApproval) throw err.inner;
      try {
        await new SolicitudApprovalRecoveryService(this.db, this.accounts).compensar(
          authUserId,
          true,
        );
      } catch {
        logSolicitudFailure('approval_claim_release_failed');
      }
      throw err;
    }

    // La cuenta ya existe y la solicitud está aprobada: el correo es de cortesía y se puede reenviar.
    let correoEnviado = false;
    try {
      const user = await this.db
        .from('users')
        .select('nombre_completo')
        .eq('id', studentId)
        .maybeSingle();
      const link = await this.accounts.generarEnlaceAcceso(correo);
      await this.email.sendAccessLinkEmail({
        to: correo,
        nombreCompleto: user.data?.nombre_completo ?? '',
        tokenHash: link.tokenHash,
        type: link.type,
        reenvio: false,
      });
      correoEnviado = true;
    } catch {
      logSolicitudFailure('approval_email_failed');
    }
    return {
      studentId,
      cohorte: null,
      pendienteCohorte: true,
      correoEnviado,
      etapa: 'por_agendar',
    };
  }

  private async finalizar(
    id: string,
    actor: string,
    claim: string,
    studentId: string,
  ): Promise<void> {
    // I02: aprobar crea el expediente, nunca el precio, la cohorte ni las prácticas.
    const result = await this.db.rpc('finalizar_aprobacion_inscripcion', {
      p_id: id,
      p_actor: actor,
      p_claim: claim,
      p_student: studentId,
      p_cohort: null,
      p_estado: 'pendiente_cohorte',
      p_monto: null,
    });
    if (!result.error && result.data) return;
    // Incluso ante una excepción de unicidad comprobar si hubo un commit previo incierto.
    const confirmed = await this.db
      .from('solicitudes_inscripcion')
      .select('estado,student_id')
      .eq('id', id)
      .maybeSingle();
    if (confirmed.error)
      throw new UncertainApproval(
        solicitudError(
          'No se pudo confirmar la aprobación. Recarga antes de reintentar.',
          503,
          'APROBACION_NO_CONFIRMADA',
        ),
      );
    if (
      (confirmed.data?.estado === 'aprobada' || confirmed.data?.estado === 'archivada') &&
      confirmed.data.student_id === studentId
    )
      return;
    if (result.error?.code === '23505')
      throw solicitudError('Ya existe un usuario con esta cédula.', 409, 'CEDULA_DUPLICADA');
    throw result.error
      ? normalizeSolicitudError(result.error)
      : solicitudError('No se pudo aprobar.', 503, 'SERVICIO_NO_DISPONIBLE');
  }

  async validarRequisitos(id: string): Promise<ApprovalVerifications> {
    const { data: s, error } = await this.db
      .from('solicitudes_inscripcion')
      .select('estado,nivel_estudios,datos_actualizados_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!s || s.estado === 'borrador')
      throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    if (s.estado !== 'enviada')
      throw solicitudError(
        'Esta acción no corresponde al estado de la solicitud.',
        409,
        'ESTADO_INCORRECTO',
      );
    const [cert, verifs] = await Promise.all([
      this.db
        .from('solicitud_documentos')
        .select('uploaded_at')
        .eq('solicitud_id', id)
        .eq('tipo_documento', 'certificado_estudios')
        .maybeSingle(),
      this.db
        .from('solicitud_verificaciones')
        .select('id,tipo,metodo,resultado,creado_at')
        .eq('solicitud_id', id)
        .order('creado_at', { ascending: true })
        .order('id', { ascending: true }),
    ]);
    if (cert.error) throw cert.error;
    if (verifs.error) throw verifs.error;
    const ctx: VerificationContext = {
      nivel: s.nivel_estudios,
      datosActualizadosAt: s.datos_actualizados_at,
      certificadoSubidoAt: cert.data?.uploaded_at ?? null,
    };
    const identidad = latestVerification(verifs.data, 'identidad');
    const estudios = latestVerification(verifs.data, 'estudios');
    if (!identidad || !verificationEnablesApproval(identidad, ctx))
      throw solicitudError(
        'Falta una verificación de identidad vigente con un método válido.',
        409,
        'IDENTIDAD_NO_VERIFICADA',
      );
    if (!estudios || !verificationEnablesApproval(estudios, ctx))
      throw solicitudError(
        'Falta una verificación de estudios vigente con un método válido.',
        409,
        'ESTUDIOS_NO_VERIFICADOS',
      );
    const check = await this.db.rpc('validar_aprobacion_inscripcion', {
      p_id: id,
      p_verif_identidad: identidad.id,
      p_verif_estudios: estudios.id,
      p_version_aviso: PRIVACY_NOTICE_VERSION,
      p_version_terminos: TERMS_VERSION,
    });
    if (check.error) throw normalizeSolicitudError(check.error);
    return { identidad: identidad.id, estudios: estudios.id };
  }
}
