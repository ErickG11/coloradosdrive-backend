import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '../config/privacy';
import type { SolicitudDocumentoResult } from '../models/solicitud.model';
import type { PreparedCertificate } from '../utils/certificateFile';
import { AppError } from '../utils/AppError';
import { normalizeSolicitudError, solicitudError } from '../utils/solicitudError';

export const CERTIFICATE_BUCKET = 'solicitudes-documentos';

// Guarda el único certificado de estudios: sube el objeto nuevo, confirma la fila en una
// sola RPC (lock + comparación de nivel y datos) y retira el anterior solo si se confirmó.
export class SolicitudCertificateStorage {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async save(
    solicitudId: string,
    context: { nivel: string; marca: string },
    subtipo: string,
    file: PreparedCertificate,
  ): Promise<SolicitudDocumentoResult> {
    const bucket = this.db.storage.from(CERTIFICATE_BUCKET);
    const ruta = `solicitudes/${solicitudId}/estudios/${randomUUID()}.${file.extension}`;
    const { error: uploadError } = await bucket.upload(ruta, file.buffer, {
      contentType: file.mime,
      upsert: false,
    });
    if (uploadError)
      throw new AppError('No se pudo guardar el documento. Intenta de nuevo.', 502, {
        code: 'SERVICIO_NO_DISPONIBLE',
      });

    const { data, error } = await this.db.rpc('guardar_certificado_inscripcion', {
      p_id: solicitudId,
      p_nivel: context.nivel,
      p_marca: context.marca,
      p_subtipo: subtipo,
      p_ruta: ruta,
      p_mime: file.mime,
      p_tamano: file.size,
      p_sha256: file.sha256,
      p_version_aviso: PRIVACY_NOTICE_VERSION,
      p_version_terminos: TERMS_VERSION,
    });
    if (error || !data) {
      // Compensación: no dejar un objeto sin fila. El trabajo de huérfanos (F20) cubre fallos de red.
      await bucket.remove([ruta]).catch(() => undefined);
      throw error
        ? normalizeSolicitudError(error)
        : solicitudError('No se pudo guardar el documento.', 503, 'SERVICIO_NO_DISPONIBLE');
    }
    if (data.rutaAnterior && data.rutaAnterior !== ruta)
      await bucket.remove([data.rutaAnterior]).catch(() => undefined);
    return {
      id: data.id,
      tipoDocumento: 'certificado_estudios',
      estado: 'recibido',
      uploadedAt: data.subidoAt,
      subtipo: data.subtipo,
      mimeType: data.mimeType,
      tamano: data.tamano,
    };
  }
}
