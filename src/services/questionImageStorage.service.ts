import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { QuestionImage } from '../models/exam.model';
import { AppError } from '../utils/AppError';
import { logSafeError } from '../utils/safeLog';

export const QUESTION_IMAGE_BUCKET = 'exam-question-images';
export const QUESTION_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const QUESTION_IMAGE_ADMIN_SECONDS = 3600;
const MESSAGES: Record<string, string> = {
  IMAGE_TOO_LARGE: 'La imagen supera el máximo de 3 MiB',
  IMAGE_TYPE_INVALID:
    'Solo se aceptan imágenes PNG, JPEG o WebP con firma válida; SVG no está permitido',
  IMAGE_NOT_FOUND: 'La pregunta no tiene una imagen',
  IMAGE_REQUIRED: 'Adjunta una imagen en el campo image',
  IMAGE_ALT_INVALID: 'El texto alternativo debe tener como máximo 300 caracteres',
  IMAGE_UPLOAD_INVALID: 'Envía una sola imagen y, opcionalmente, su texto alternativo',
  IMAGE_UPLOAD_FAILED: 'No se pudo subir la imagen. Intenta de nuevo',
  IMAGE_CONFLICT: 'La imagen cambió mientras la editabas. Recarga la pregunta e intenta de nuevo',
  EXAM_PUBLISHED_UNPUBLISH:
    'Despublica el examen antes de editar sus imágenes o su texto alternativo',
};
export function questionImageError(code: string, status = 400): AppError {
  return new AppError(MESSAGES[code] ?? 'No se pudo procesar la imagen', status, { code });
}
export function questionImageType(bytes: Buffer): { mime: string; extension: string } {
  if (bytes.length > QUESTION_IMAGE_MAX_BYTES) throw questionImageError('IMAGE_TOO_LARGE', 413);
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mime: 'image/png', extension: 'png' };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { mime: 'image/jpeg', extension: 'jpg' };
  if (
    bytes.length >= 16 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))
  )
    return { mime: 'image/webp', extension: 'webp' };
  throw questionImageError('IMAGE_TYPE_INVALID');
}
export function questionImageAlt(alt: string | null): string | null {
  if (alt !== null && (typeof alt !== 'string' || Array.from(alt).length > 300))
    throw questionImageError('IMAGE_ALT_INVALID');
  const trimmed = alt?.trim() ?? null;
  return trimmed === '' ? null : trimmed;
}
export function attemptImageSeconds(deadline: string, now = Date.now()): number {
  const remaining = Math.floor((Date.parse(deadline) + 5 * 60_000 - now) / 1000);
  return Number.isFinite(remaining) ? Math.max(0, Math.min(4 * 3600, remaining)) : 0;
}
export async function signQuestionImage(
  client: SupabaseClient<Database>,
  row: { image_path?: string | null; image_alt?: string | null },
  seconds = QUESTION_IMAGE_ADMIN_SECONDS,
): Promise<QuestionImage | null> {
  if (!row.image_path || seconds <= 0) return null;
  try {
    const { data, error } = await client.storage
      .from(QUESTION_IMAGE_BUCKET)
      .createSignedUrl(row.image_path, seconds);
    if (error || !data.signedUrl) {
      logSafeError('question_image_sign_failed', error);
      return null;
    }
    return { url: data.signedUrl, alt: row.image_alt ?? null };
  } catch (error) {
    logSafeError('question_image_sign_failed', error);
    return null;
  }
}
export async function removeQuestionImages(
  client: SupabaseClient<Database>,
  paths: string[],
): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  // Storage limita el numero de objetos por solicitud; siempre despues de confirmar SQL.
  for (let start = 0; start < unique.length; start += 100) {
    try {
      const { error } = await client.storage
        .from(QUESTION_IMAGE_BUCKET)
        .remove(unique.slice(start, start + 100));
      if (error) logSafeError('question_image_cleanup_failed', error);
    } catch (error) {
      logSafeError('question_image_cleanup_failed', error);
    }
  }
}

export async function signQuestionImages(
  client: SupabaseClient<Database>,
  rows: { image_path?: string | null; image_alt?: string | null }[],
  seconds: number | (() => number) = QUESTION_IMAGE_ADMIN_SECONDS,
): Promise<(QuestionImage | null)[]> {
  const images: (QuestionImage | null)[] = rows.map(() => null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (next < rows.length) {
        const index = next++;
        images[index] = await signQuestionImage(client, rows[index], typeof seconds === 'function' ? seconds() : seconds);
      }
    }),
  );
  return images;
}
