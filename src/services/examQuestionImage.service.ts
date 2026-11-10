import { randomUUID } from 'node:crypto';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { ContentData, ContentValue } from '../models/content.model';
import { AppError } from '../utils/AppError';
import { logSafeError } from '../utils/safeLog';
import { ContentService, contentError, translateContentDatabaseError } from './content.service';
import {
  QUESTION_IMAGE_BUCKET,
  questionImageAlt,
  questionImageError,
  questionImageType,
  removeQuestionImages,
} from './questionImageStorage.service';

interface ImageReference {
  image_path: string | null;
  previous_path: string | null;
}
export class ExamQuestionImageService {
  constructor(private readonly client: SupabaseClient<Database>) {}
  private async manage(
    actor: string,
    exam: string,
    question: string,
    action: string,
    data: ContentData = {},
  ): Promise<ImageReference> {
    let result: { data: ContentValue | null; error: PostgrestError | null };
    try {
      result = await this.client.rpc('exam_question_image', {
        p_actor: actor,
        p_exam: exam,
        p_question: question,
        p_action: action,
        p_data: data,
      });
    } catch (error) {
      logSafeError('question_image_database_failed', error);
      throw contentError('CONTENT_UNAVAILABLE', 503);
    }
    if (result.error) {
      const code = result.error.message;
      if (['IMAGE_NOT_FOUND', 'IMAGE_CONFLICT', 'EXAM_PUBLISHED_UNPUBLISH'].includes(code))
        throw questionImageError(code, code === 'IMAGE_NOT_FOUND' ? 404 : 409);
      throw translateContentDatabaseError(result.error);
    }
    return result.data as unknown as ImageReference;
  }
  async upload(
    actor: string,
    exam: string,
    question: string,
    file: Express.Multer.File,
    alt?: string | null,
  ): Promise<void> {
    const { mime, extension } = questionImageType(file.buffer);
    const fields = alt === undefined ? {} : { alt: questionImageAlt(alt) };
    const before = await this.manage(actor, exam, question, 'inspect');
    await new ContentService(this.client).admin(actor, 'upload.reserve', {});
    const path = `exams/${exam}/${randomUUID()}.${extension}`;
    try {
      const uploaded = await this.client.storage
        .from(QUESTION_IMAGE_BUCKET)
        .upload(path, file.buffer, { contentType: mime, upsert: false, cacheControl: '60' });
      if (uploaded.error) throw uploaded.error;
    } catch (error) {
      logSafeError('question_image_upload_failed', error);
      await removeQuestionImages(this.client, [path]);
      throw questionImageError('IMAGE_UPLOAD_FAILED', 503);
    }
    try {
      await this.manage(actor, exam, question, 'set', {
        expected_path: before.image_path,
        path,
        ...fields,
      });
    } catch (error) {
      // Un error de dominio confirma ROLLBACK; un timeout puede haber confirmado SQL.
      // Con resultado incierto conservar el objeto para no romper una referencia valida.
      if (error instanceof AppError && error.statusCode < 500)
        await removeQuestionImages(this.client, [path]);
      else logSafeError('question_image_reference_uncertain', error);
      throw error;
    }
    if (before.image_path) await removeQuestionImages(this.client, [before.image_path]);
  }
  async updateAlt(
    actor: string,
    exam: string,
    question: string,
    alt: string | null,
  ): Promise<void> {
    await this.manage(actor, exam, question, 'alt', { alt: questionImageAlt(alt) });
  }
  async remove(actor: string, exam: string, question: string): Promise<void> {
    const before = await this.manage(actor, exam, question, 'inspect');
    if (!before.image_path) throw questionImageError('IMAGE_NOT_FOUND', 404);
    const result = await this.manage(actor, exam, question, 'clear', {
      expected_path: before.image_path,
    });
    if (result.previous_path) await removeQuestionImages(this.client, [result.previous_path]);
  }
}
