import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { SolicitudDocumentoResult, SolicitudTipoDocumento, UploadedFile } from '../models/solicitud.model';
import { AppError } from '../utils/AppError';
import { solicitudError } from '../utils/solicitudError';
import { detectFileType } from '../utils/fileSignature';
const SOLICITUDES_BUCKET='solicitudes-documentos';
const EXTENSION_BY_DETECTED_TYPE:Record<string,string>={'image/jpeg':'jpg','image/png':'png','application/pdf':'pdf'};
export class SolicitudDocumentStorage {
 constructor(private readonly supabase:SupabaseClient<Database>){}
 async upload(solicitudId:string,tipoDocumento:SolicitudTipoDocumento,file:UploadedFile):Promise<SolicitudDocumentoResult>{
  if (!file.buffer.length || file.size>5*1024*1024 || file.buffer.length>5*1024*1024) throw solicitudError('Selecciona un archivo no vacío de hasta 5 MiB',400,'ARCHIVO_INVALIDO');
    const detectedType = detectFileType(file.buffer);
    if (!detectedType) {
      throw new AppError('Tipo de archivo no permitido (solo JPG, PNG o PDF)', 400);
    }
    const extension = EXTENSION_BY_DETECTED_TYPE[detectedType];

    const { data: existing, error: existingError } = await this.supabase
      .from('solicitud_documentos')
      .select()
      .eq('solicitud_id', solicitudId)
      .eq('tipo_documento', tipoDocumento)
      .maybeSingle();
    if (existingError) {
      throw existingError;
    }
    if (existing?.estado === 'aprobado') {
      throw solicitudError('Este documento ya fue aprobado y no se puede reemplazar',409,'DOCUMENTO_YA_APROBADO');
    }

    const storagePath = `${solicitudId}/${tipoDocumento}-${randomUUID()}.${extension}`;
    const bucket = this.supabase.storage.from(SOLICITUDES_BUCKET);

    const { error: uploadError } = await bucket.upload(storagePath, file.buffer, {
      contentType: detectedType,
      upsert: false,
    });
    if (uploadError) {
      throw new AppError('No se pudo guardar el documento. Intenta de nuevo', 502);
    }

    const now = new Date().toISOString();
    const { data, error } = existing
      ? await this.supabase
          .from('solicitud_documentos')
          .update({
            storage_path: storagePath,
            estado: 'recibido',
            motivo_rechazo: null,
            uploaded_at: now,
            reviewed_at: null,
            reviewed_by: null,
          })
          .eq('id', existing.id)
          .neq('estado', 'aprobado')
          .eq('storage_path', existing.storage_path)
          .select()
          .maybeSingle()
      : await this.supabase
          .from('solicitud_documentos')
          .insert({
            solicitud_id: solicitudId,
            tipo_documento: tipoDocumento,
            storage_path: storagePath,
          })
          .select()
          .single();

    if (error || !data) {
      // Compensación: no dejar un objeto huérfano en Storage.
      await bucket.remove([storagePath]).catch(() => undefined);
      if (error) throw error;
      throw solicitudError('El documento cambió durante la subida. Consulta de nuevo tu progreso', 409, 'DOCUMENTO_YA_REVISADO');
    }

    if (existing) {
      await bucket.remove([existing.storage_path]).catch(() => undefined);
    }

    return {
      id: data.id,
      tipoDocumento: data.tipo_documento,
      estado: data.estado,
      uploadedAt: data.uploaded_at,
    };
  }

}
