import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '../config/privacy';
import { MOTIVOS_RECHAZO } from '../config/enrollmentCatalog';
import { calcularEdad } from '../utils/solicitudAge';
import { requireKnownFields } from '../utils/enrollmentSanitization';
import { privacyContent } from '../config/enrollmentLegal';
import { normalizeSolicitudError, solicitudError } from '../utils/solicitudError';

type Consent = Database['public']['Tables']['solicitud_consentimientos']['Row'];
export function privacyNotice(): ReturnType<typeof privacyContent> {
  return privacyContent();
}
export class SolicitudPrivacyService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  async currentConsent(id: string): Promise<Consent | null> {
    const { data, error } = await this.db
      .from('solicitud_consentimientos')
      .select()
      .eq('solicitud_id', id)
      .eq('version_aviso', PRIVACY_NOTICE_VERSION)
      .eq('version_terminos', TERMS_VERSION)
      .maybeSingle();
    if (error) throw error;
    return data?.acepto_tratamiento && data.declara_veracidad && data.acepto_terminos ? data : null;
  }
  async requireConsent(id: string): Promise<Consent> {
    const consent = await this.currentConsent(id);
    if (!consent)
      throw solicitudError(
        'Acepta el aviso y los términos vigentes',
        409,
        'CONSENTIMIENTO_REQUERIDO',
      );
    return consent;
  }
  async accept(
    id: string,
    input: unknown,
  ): Promise<{
    version: string;
    versionAviso: string;
    versionTerminos: string;
    aceptadoAt: string;
  }> {
    requireKnownFields(input, [
      'versionAviso',
      'versionTerminos',
      'aceptoTratamiento',
      'declaraVeracidad',
      'aceptoTerminos',
      'representanteAcepta',
    ]);
    if (input.versionAviso !== PRIVACY_NOTICE_VERSION)
      throw solicitudError(
        'El aviso cambió. Revisa la versión vigente.',
        409,
        'AVISO_DESACTUALIZADO',
      );
    if (input.versionTerminos !== TERMS_VERSION)
      throw solicitudError(
        'Los términos cambiaron. Revisa la versión vigente.',
        409,
        'TERMINOS_DESACTUALIZADOS',
      );
    if (
      input.aceptoTratamiento !== true ||
      input.declaraVeracidad !== true ||
      input.aceptoTerminos !== true
    )
      throw solicitudError(
        'Acepta el tratamiento, la declaración de veracidad y los términos.',
        400,
        'CONSENTIMIENTO_REQUERIDO',
      );
    if (input.representanteAcepta !== undefined && typeof input.representanteAcepta !== 'boolean')
      throw solicitudError(
        'La autorización del representante debe ser un booleano.',
        400,
        'REPRESENTANTE_INVALIDO',
      );
    const { data, error } = await this.db.rpc('aceptar_consentimiento_inscripcion', {
      p_id: id,
      p_version_aviso: PRIVACY_NOTICE_VERSION,
      p_version_terminos: TERMS_VERSION,
      p_representante: input.representanteAcepta === true,
    });
    if (error) throw normalizeSolicitudError(error);
    if (!data)
      throw solicitudError(
        'No se pudo registrar el consentimiento. Intenta de nuevo.',
        503,
        'SERVICIO_NO_DISPONIBLE',
      );
    return data;
  }
  async progress(id: string): Promise<{
    courseId: string;
    curso: { id: string; tipo: 'A' | 'B'; nombre: string; edadMinima: number } | null;
    estado: string;
    revokedAt?: string | null;
    enviadaAt: string | null;
    correoVerificado: boolean;
    identidadVerificada: boolean;
    estudiosVerificados: boolean;
    consentimientoVigente: boolean;
    datosGuardados: boolean;
    solicitadaAt: string | null;
    requiereRepresentante: boolean;
    representanteCompleto: boolean;
    nivelEstudios: string | null;
    documentoRequerido: boolean;
    documentoEstudiosPendientePorCupo: boolean;
    devolucion: {
      motivoCodigo: string | null;
      mensaje: string | null;
      devueltaAt: string | null;
    } | null;
    motivoRechazo?: string | null;
    datos: {
      nombres: string | null;
      apellidos: string | null;
      cedula: string | null;
      fechaNacimiento: string | null;
      telefono: string | null;
      nacionalidadTipo: string | null;
      tipoSangre: string | null;
      representante: { nombre: string; cedula: string; acepta: boolean } | null;
    };
    pasosCompletos: {
      correo: boolean;
      consentimiento: boolean;
      datos: boolean;
      estudios: boolean;
      enviada: boolean;
    };
    documentos: { tipo: string; estado: string; motivoRechazo: string | null }[];
  }> {
    const { data: row, error } = await this.db
      .from('solicitudes_inscripcion')
      .select()
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw solicitudError('La solicitud no existe', 404, 'NO_ENCONTRADO');
    const consent = await this.currentConsent(id);
    const docs = await this.db
      .from('solicitud_documentos')
      .select('tipo_documento,estado,motivo_rechazo')
      .eq('solicitud_id', id)
      .eq('tipo_documento', 'certificado_estudios');
    if (docs.error) throw docs.error;
    const course = await this.db
      .from('courses')
      .select('id,tipo,nombre,edad_minima')
      .eq('id', row.course_id)
      .maybeSingle();
    if (course.error) throw course.error;
    // La última fila manda; el DTO público solo contiene dos booleanos.
    const [identidad, estudios] = await Promise.all(
      (['identidad', 'estudios'] as const).map((tipo) =>
        this.db
          .from('solicitud_verificaciones')
          .select('resultado')
          .eq('solicitud_id', id)
          .eq('tipo', tipo)
          .order('creado_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    );
    if (identidad.error) throw identidad.error;
    if (estudios.error) throw estudios.error;
    const requerido = ['bachiller_exterior', 'decimo_aprobado', 'cursando_bachillerato'].includes(
      row.nivel_estudios ?? '',
    );
    const guardados = Boolean(
      row.nombres &&
      row.apellidos &&
      row.cedula &&
      row.telefono &&
      row.fecha_nacimiento &&
      row.nacionalidad_tipo &&
      row.tipo_sangre,
    );
    const certificados = docs.data.filter((d) => d.tipo_documento === 'certificado_estudios');
    const rechazo = Object.entries(MOTIVOS_RECHAZO).find(
      ([codigo]) => codigo === row.rechazo_motivo_codigo,
    )?.[1];
    return {
      courseId: row.course_id,
      curso: course.data
        ? {
            id: course.data.id,
            tipo: course.data.tipo,
            nombre: course.data.nombre,
            edadMinima: course.data.edad_minima,
          }
        : null,
      estado: row.estado,
      revokedAt: row.revoked_at,
      enviadaAt: row.enviada_at ?? null,
      correoVerificado: row.correo_verificado,
      identidadVerificada: identidad.data?.resultado === 'verificado',
      estudiosVerificados: estudios.data?.resultado === 'verificado',
      consentimientoVigente: Boolean(consent),
      datosGuardados: guardados,
      solicitadaAt: row.solicitada_at,
      requiereRepresentante: Boolean(
        row.fecha_nacimiento && calcularEdad(row.fecha_nacimiento) < 18,
      ),
      representanteCompleto: Boolean(
        consent?.representante_autoriza_tratamiento &&
        consent.representante_acepta &&
        consent.representante_nombre &&
        consent.representante_cedula,
      ),
      nivelEstudios: row.nivel_estudios ?? null,
      documentoRequerido: requerido,
      documentoEstudiosPendientePorCupo: row.documento_estudios_pendiente_por_cupo,
      devolucion:
        row.estado === 'devuelta'
          ? {
              motivoCodigo: row.devolucion_motivo_codigo ?? null,
              mensaje: row.devolucion_mensaje ?? null,
              devueltaAt: row.devuelta_at ?? null,
            }
          : null,
      ...(row.estado === 'rechazada'
        ? {
            motivoRechazo: rechazo?.mensaje ?? row.motivo_rechazo,
          }
        : {}),
      datos: {
        nombres: row.nombres ?? null,
        apellidos: row.apellidos ?? null,
        cedula: row.cedula,
        fechaNacimiento: row.fecha_nacimiento,
        telefono: row.telefono,
        nacionalidadTipo: row.nacionalidad_tipo ?? null,
        tipoSangre: row.tipo_sangre ?? null,
        representante:
          consent?.representante_nombre && consent.representante_cedula
            ? {
                nombre: consent.representante_nombre,
                cedula: consent.representante_cedula,
                acepta: consent.representante_acepta && consent.representante_autoriza_tratamiento,
              }
            : null,
      },
      pasosCompletos: {
        correo: row.correo_verificado,
        consentimiento: Boolean(consent),
        datos: guardados,
        estudios: Boolean(
          row.nivel_estudios &&
          (!requerido || certificados.length || row.documento_estudios_pendiente_por_cupo),
        ),
        enviada: Boolean(row.enviada_at),
      },
      documentos: certificados.map((d) => ({
        tipo: d.tipo_documento,
        estado: d.estado,
        motivoRechazo: d.motivo_rechazo ?? null,
      })),
    };
  }
}
