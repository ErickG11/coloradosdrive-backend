import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { ContentData, ContentValue, ItemAccess } from '../models/content.model';
import { AppError } from '../utils/AppError';

const MESSAGES: Record<string, string> = {
  CONTENT_HAS_DEPENDENCIES:
    'No se puede eliminar: tiene contenido, reglas o progreso vinculados; despublícalo o retira las dependencias',
  CONTENT_DUPLICATE: 'El título, la colocación o la posición ya están ocupados',
  INVALID_ORDER: 'Envía todos los elementos de la materia o curso, sin repetir IDs',
  ITEM_COURSE_MISMATCH: 'El examen y la materia deben pertenecer al mismo curso',
  TARGET_COURSE_MISMATCH: 'La cohorte debe pertenecer al curso del contenido',
  TARGET_ENROLLMENT_REQUIRED:
    'El alumno necesita matrícula activa, etapa activa y cohorte del curso',
  CLOSES_AT_PAST: 'La fecha de cierre debe estar en el futuro',
  EXAM_RULE_ONLY: 'Los intentos y minutos extra solo se configuran para exámenes',
  FILE_TOO_LARGE: 'El archivo supera 10 MiB',
  INVALID_FILE_SIGNATURE: 'Solo se aceptan archivos con firma PDF, PNG o JPG',
  ITEM_NOT_FOUND: 'Contenido no encontrado',
  ITEM_NO_HABILITADO: 'Contenido no habilitado',
  ITEM_PROGRAMADO: 'El contenido todavía no abre',
  ITEM_CERRADO: 'La ventana de acceso terminó',
  ATTEMPTS_EXHAUSTED: 'Se agotaron los intentos permitidos',
  ALREADY_PASSED: 'El definitivo ya fue aprobado',
  MARCA_NO_REVERSIBLE: 'Un material completado no se puede volver a marcar como pendiente.',
  MATERIALES_PENDIENTES: 'Antes de rendir este examen, completa los materiales obligatorios previos.',
  EXAM_NOT_PUBLISHED: 'El examen no está publicado',
  ATTEMPT_COMPLETED: 'Este intento ya fue calificado',
  ATTEMPT_EXPIRED:
    'El tiempo límite de este examen ya expiró; el intento se calificó con las respuestas que alcanzaste a registrar',
  EXAM_STRUCTURE_FROZEN: 'El examen tiene intentos: solo se permiten correcciones de texto',
  EXAM_HAS_ATTEMPTS_UNPUBLISH: 'El examen tiene intentos: despublícalo',
  SUBJECT_HAS_ITEMS_UNPUBLISH: 'La materia tiene elementos: muévelos o despublica la materia',
  ITEM_HAS_PROGRESS_UNPUBLISH: 'El elemento tiene progreso o intentos: despublica su contenido',
  EXAM_INVALID_QUESTIONS:
    'Publicar exige preguntas y exactamente una opción correcta por pregunta múltiple',
  UPLOAD_DAILY_LIMIT: 'Límite de 50 subidas por administrador y día alcanzado',
};

export function contentError(code: string, status?: number): AppError {
  return new AppError(
    MESSAGES[code] ??
      'No se pudo guardar: revisa el contenido, sus dependencias y el curso del destinatario',
    status ??
      (code === 'ITEM_NOT_FOUND'
        ? 404
        : code === 'UPLOAD_DAILY_LIMIT'
          ? 429
          : code.startsWith('ITEM_')
            ? 403
            : 409),
    { code },
  );
}

export interface PendingMaterial {
  item_id: string;
  titulo: string;
}

function pendingMaterials(value: unknown): PendingMaterial[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { item_id?: unknown; titulo?: unknown };
    return typeof row.item_id === 'string' && typeof row.titulo === 'string'
      ? [{ item_id: row.item_id, titulo: row.titulo }]
      : [];
  });
}

export function checkContentResult(value: ContentValue): ContentValue {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.error === 'string'
  ) {
    if (value.error === 'MATERIALES_PENDIENTES') {
      const pendientes = pendingMaterials(value.pendientes);
      throw new AppError(
        `Antes de rendir este examen, completa: ${pendientes.map((p) => p.titulo).join(', ')}.`,
        409,
        { code: 'MATERIALES_PENDIENTES', detalles: { pendientes } },
      );
    }
    throw contentError(value.error);
  }
  return value;
}

export function translateContentDatabaseError(error: { code: string; message: string }): Error {
  if (error.code.startsWith('CF'))
    return contentError(
      error.message,
      error.code === 'CF404' ? 404 : error.code === 'CF429' ? 429 : 409,
    );
  if (error.code === '23503') return contentError('CONTENT_HAS_DEPENDENCIES', 409);
  if (error.code === '23505') return contentError('CONTENT_DUPLICATE', 409);
  if (error.code.startsWith('22') || error.code === '23514' || error.code === '23502')
    return contentError('INVALID_CONTENT', 400);
  if (error.code === '42501') return contentError('ACCESS_DENIED', 403);
  return contentError('CONTENT_UNAVAILABLE', 503);
}

export class ContentService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async admin(actor: string, action: string, data: ContentData): Promise<ContentValue> {
    const result = await this.client.rpc('content_admin', {
      p_actor: actor,
      p_action: action,
      p_data: data,
    });
    if (result.error) throw translateContentDatabaseError(result.error);
    return checkContentResult(result.data);
  }

  async student(student: string, action: string, data: ContentData = {}): Promise<ContentValue> {
    const result = await this.client.rpc('content_student', {
      p_student: student,
      p_action: action,
      p_data: data,
    });
    if (result.error) throw translateContentDatabaseError(result.error);
    return checkContentResult(result.data);
  }

  async examAccess(student: string, exam: string): Promise<ItemAccess> {
    const result = await this.client.rpc('content_exam_access', {
      p_student: student,
      p_exam: exam,
    });
    if (result.error) throw translateContentDatabaseError(result.error);
    return checkContentResult(result.data) as ItemAccess;
  }

  async open(student: string, item: string): Promise<ContentValue> {
    const data = (await this.student(student, 'open', { item_id: item })) as ContentData;
    if (data.kind !== 'archivo')
      return { kind: data.kind, title: data.title, url: data.url, body: data.body };
    if (typeof data.storage_path !== 'string') throw contentError('CONTENT_UNAVAILABLE', 503);
    // El nombre de descarga lo genera el servidor; ningún nombre del cliente llega a la cabecera.
    const result = await this.client.storage
      .from('course-content')
      .createSignedUrl(data.storage_path, 60, { download: true });
    if (result.error) throw contentError('CONTENT_UNAVAILABLE', 503);
    return { kind: 'archivo', title: data.title, url: result.data.signedUrl, expires_in: 60 };
  }

  async upload(
    actor: string,
    file: Express.Multer.File,
    fields: ContentData,
  ): Promise<ContentValue> {
    const bytes = file.buffer;
    let mime: string;
    let extension: string;
    if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      mime = 'application/pdf';
      extension = 'pdf';
    } else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      mime = 'image/png';
      extension = 'png';
    } else if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      mime = 'image/jpeg';
      extension = 'jpg';
    } else throw contentError('INVALID_FILE_SIGNATURE', 400);
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024)
      throw contentError('FILE_TOO_LARGE', 413);
    await this.admin(actor, 'upload.reserve', {});
    const path = `${actor}/${randomUUID()}.${extension}`;
    const uploaded = await this.client.storage
      .from('course-content')
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (uploaded.error) throw contentError('UPLOAD_FAILED', 503);
    try {
      return await this.admin(actor, 'materials.save', {
        ...fields,
        kind: 'archivo',
        storage_path: path,
        mime_type: mime,
        size_bytes: bytes.length,
      });
    } catch (error) {
      await this.client.storage.from('course-content').remove([path]);
      throw error;
    }
  }
}
