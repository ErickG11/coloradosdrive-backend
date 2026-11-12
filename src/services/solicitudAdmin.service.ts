import { enrollmentRuleEnabled } from './enrollmentRuleFlags.service';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import {
  NIVELES_ESTUDIOS,
  metodoHabilitaAprobacion,
  type NivelEstudios,
} from '../config/enrollmentCatalog';
import { sanitizeEnrollmentText } from '../utils/enrollmentSanitization';
import { validateAdminVerification } from '../utils/enrollmentValidation';
import {
  isKnownLevel,
  isVerificationFresh,
  type VerificationContext,
} from '../utils/enrollmentVerification';
import { normalizeSolicitudError, solicitudError } from '../utils/solicitudError';
import { recordSolicitudAudit } from './solicitudAudit.service';
import { CERTIFICATE_BUCKET } from './solicitudCertificateStorage.service';

export const CERTIFICATE_URL_SECONDS = 300;
export const ADMIN_ESTADOS_LISTA = [
  'enviada',
  'devuelta',
  'aprobada',
  'rechazada',
  'archivada',
] as const;
export type AdminEstadoLista = (typeof ADMIN_ESTADOS_LISTA)[number];

export interface AdminListResult {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

// Consultas y acciones del admin sobre solicitudes que ya salieron de borrador. Los textos de
// búsqueda solo viajan como parámetros de una función SQL (nunca en filtros PostgREST).
export class SolicitudAdminService {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async listar(
    estado: AdminEstadoLista | undefined,
    q: string,
    page: number,
    pageSize: number,
  ): Promise<AdminListResult> {
    const texto = sanitizeEnrollmentText(q).slice(0, 100);
    const { data, error } = await this.db.rpc('listar_solicitudes_admin', {
      p_estado: estado ?? null,
      p_q: texto === '' ? null : texto,
      p_page: page,
      p_size: pageSize,
    });
    if (error || !data)
      throw solicitudError('No se pudo consultar la lista.', 503, 'SERVICIO_NO_DISPONIBLE');
    return data;
  }

  async detalle(id: string, actor?: string): Promise<Record<string, unknown>> {
    const { data: s, error } = await this.db
      .from('solicitudes_inscripcion')
      .select()
      .eq('id', id)
      .neq('estado', 'borrador')
      .maybeSingle();
    if (error) throw error;
    if (!s) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    const [course, cert, consent, verifs] = await Promise.all([
      this.db
        .from('courses')
        .select('id,tipo,nombre,edad_minima')
        .eq('id', s.course_id)
        .maybeSingle(),
      this.db
        .from('solicitud_documentos')
        .select()
        .eq('solicitud_id', id)
        .eq('tipo_documento', 'certificado_estudios')
        .maybeSingle(),
      this.db
        .from('solicitud_consentimientos')
        .select()
        .eq('solicitud_id', id)
        .order('aceptado_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.db
        .from('solicitud_verificaciones')
        .select()
        .eq('solicitud_id', id)
        .order('creado_at', { ascending: false })
        .order('id', { ascending: false }),
    ]);
    for (const r of [course, cert, consent, verifs]) if (r.error) throw r.error;

    const actorIds = [...new Set((verifs.data ?? []).map((v) => v.actor_id))];
    const names = new Map<string, string>();
    if (actorIds.length > 0) {
      const users = await this.db.from('users').select('id,nombre_completo').in('id', actorIds);
      if (users.error) throw users.error;
      for (const u of users.data) names.set(u.id, u.nombre_completo);
    }

    const nivel = s.nivel_estudios;
    const config = isKnownLevel(nivel) ? NIVELES_ESTUDIOS[nivel] : null;
    const ctx: VerificationContext = {
      nivel,
      datosActualizadosAt: s.datos_actualizados_at,
      certificadoSubidoAt: cert.data?.uploaded_at ?? null,
    };
    const certRow = cert.data;
    const disponible = certRow?.storage_path != null && certRow.archivo_eliminado_at === null;
    return {
      id: s.id,
      courseId: s.course_id,
      correo: s.correo,
      nombres: s.nombres,
      apellidos: s.apellidos,
      nombreCompleto: s.nombre_completo,
      cedula: s.cedula,
      estado: s.estado,
      nivelEstudios: nivel,
      enviadaAt: s.enviada_at,
      devueltaAt: s.devuelta_at,
      createdAt: s.created_at,
      telefono: s.telefono,
      fechaNacimiento: s.fecha_nacimiento,
      nacionalidadTipo: s.nacionalidad_tipo,
      tipoSangre: s.tipo_sangre,
      curso: course.data
        ? {
            id: course.data.id,
            tipo: course.data.tipo,
            nombre: course.data.nombre,
            edadMinima: course.data.edad_minima,
          }
        : null,
      documentoRequerido: config?.archivo === 'obligatorio',
      documentoEstudiosPendientePorCupo: s.documento_estudios_pendiente_por_cupo,
      certificado:
        certRow && disponible
          ? {
              id: certRow.id,
              subtipo: certRow.subtipo,
              mimeType: certRow.mime_type,
              tamano: certRow.size_bytes,
              uploadedAt: certRow.uploaded_at,
              verificadoAt: certRow.archivo_verificado_at,
            }
          : null,
      consentimiento: consent.data
        ? {
            versionAviso: consent.data.version_aviso,
            versionTerminos: consent.data.version_terminos,
            aceptadoAt: consent.data.aceptado_at,
            representanteNombre: consent.data.representante_nombre,
            representanteCedula: consent.data.representante_cedula,
            representanteAcepta: consent.data.representante_acepta,
          }
        : null,
      verificaciones: (verifs.data ?? []).map((v) => ({
        id: v.id,
        tipo: v.tipo,
        metodo: v.metodo,
        resultado: v.resultado,
        nota: v.nota,
        porNombre: names.get(v.actor_id) ?? null,
        createdAt: v.creado_at,
        // Una verificación anterior a un cambio de datos o de certificado ya no sirve.
        mode: v.mode,
        scanAvailable: Boolean(v.scan_path && !v.scan_deleted_at),
        vigente: isVerificationFresh(v, ctx),
      })),
      devolucionMotivoCodigo: s.devolucion_motivo_codigo,
      devolucionMensaje: s.devolucion_mensaje,
      devolucionNotaInterna: s.devolucion_nota_interna,
      rechazoMotivoCodigo: s.rechazo_motivo_codigo,
      rechazoNotaInterna: s.rechazo_nota_interna,
      studentId: s.student_id,
      updatedAt: s.updated_at,
      archivedAt: s.archived_at,
      revokedAt: s.revoked_at,
      revocationPaymentReview: s.revocation_payment_review,
      reviewOwned:
        s.review_owner === actor &&
        Boolean(s.review_until && Date.parse(s.review_until) > Date.now()),
      identityRulesActive: await enrollmentRuleEnabled(this.db, 'identity'),
    };
  }

  async registrarVerificacion(
    id: string,
    actor: string,
    input: unknown,
  ): Promise<Record<string, unknown>> {
    const v = validateAdminVerification(input);
    const { data: s, error } = await this.db
      .from('solicitudes_inscripcion')
      .select('estado,nivel_estudios')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!s || s.estado === 'borrador')
      throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    if (!isKnownLevel(s.nivel_estudios))
      throw solicitudError('La solicitud no tiene nivel de estudios', 409, 'DATOS_REQUERIDOS');
    const nivel: NivelEstudios = s.nivel_estudios;
    const { data, error: rpcError } = await this.db.rpc('registrar_verificacion_inscripcion', {
      p_id: id,
      p_actor: actor,
      p_tipo: v.tipo,
      p_metodo: v.metodo,
      p_resultado: v.resultado,
      p_nota: v.nota === null || v.nota === '' ? null : v.nota,
      p_habilita: metodoHabilitaAprobacion(v.tipo, nivel, v.metodo),
    });
    if (rpcError) throw normalizeSolicitudError(rpcError);
    if (!data)
      throw solicitudError('No se pudo registrar la verificación.', 503, 'SERVICIO_NO_DISPONIBLE');
    const user = await this.db
      .from('users')
      .select('nombre_completo')
      .eq('id', actor)
      .maybeSingle();
    return { ...data, porNombre: user.data?.nombre_completo ?? null };
  }

  // Enlace firmado de 300 s como descarga. Se audita antes de firmarlo: sin rastro no hay enlace.
  async urlCertificado(id: string, actor: string): Promise<{ url: string; expiresIn: number }> {
    const { data: s, error } = await this.db
      .from('solicitudes_inscripcion')
      .select('estado')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!s || s.estado === 'borrador')
      throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    const doc = await this.db
      .from('solicitud_documentos')
      .select('id,storage_path')
      .eq('solicitud_id', id)
      .eq('tipo_documento', 'certificado_estudios')
      .maybeSingle();
    if (doc.error) throw doc.error;
    const ruta = doc.data?.storage_path as string | null | undefined;
    if (!doc.data || !ruta)
      throw solicitudError('La solicitud no tiene certificado disponible', 404, 'NO_ENCONTRADO');
    await recordSolicitudAudit(this.db, id, actor, 'abrir_certificado', doc.data.id);
    const signed = await this.db.storage
      .from(CERTIFICATE_BUCKET)
      .createSignedUrl(ruta, CERTIFICATE_URL_SECONDS, { download: true });
    if (signed.error)
      throw solicitudError('No se pudo abrir el documento', 502, 'SERVICIO_NO_DISPONIBLE');
    return { url: signed.data.signedUrl, expiresIn: CERTIFICATE_URL_SECONDS };
  }
}
