import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '../config/privacy';
import {
  latestVerification,
  verificationEnablesApproval,
  type VerificationContext,
} from '../utils/enrollmentVerification';
import { normalizeSolicitudError, solicitudError } from '../utils/solicitudError';

export interface ApprovalVerifications {
  identidad: string;
  estudios: string;
}

// Requisitos de aprobar una solicitud enviada. Los métodos válidos salen de enrollmentCatalog.ts;
// la base de datos vuelve a comprobar, con la solicitud bloqueada, que esas verificaciones siguen
// siendo las más recientes y vigentes (validar_aprobacion_inscripcion).
export class SolicitudApprovalService {
  constructor(private readonly db: SupabaseClient<Database>) {}

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
      throw solicitudError('Esta acción no corresponde al estado de la solicitud.', 409, 'ESTADO_INCORRECTO');
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
