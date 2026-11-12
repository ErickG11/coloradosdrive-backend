import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../config/database.types';
import type { UploadedFile } from '../models/solicitud.model';
import { prepareCertificate } from '../utils/certificateFile';
import { CERTIFICATE_BUCKET } from './solicitudCertificateStorage.service';
import { cohortError } from '../config/cohortErrors';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { enrollmentRuleEnabled } from './enrollmentRuleFlags.service';
export class RequestReviewService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  async state(actor: string, id: string, claim = false) {
    if (!(await enrollmentRuleEnabled(this.db, 'identity'))) return { active: false };
    const result = await this.db.rpc('request_review_v2', {
      p_actor: actor,
      p_id: id,
      p_claim: claim,
    });
    if (result.error) throwStudentScheduleError(result.error);
    return result.data;
  }
  async verify(
    actor: string,
    id: string,
    input: Record<string, unknown>,
    file?: UploadedFile & { originalname: string },
  ) {
    const review = await this.state(actor, id);
    if (
      !review.active ||
      !('owned' in review) ||
      !review.owned ||
      !review.token ||
      input.token !== review.token
    )
      throw cohortError('SOLICITUD_REVISION_REQUERIDA');
    const scanMode = input.mode === 'presencial';
    if (scanMode && !file) throw cohortError('SOLICITUD_ESCANEO_REQUERIDO');
    if (!scanMode && file) throw cohortError('SOLICITUD_VERIFICACION_INVALIDA');
    let scan: Json = null,
      path: string | null = null;
    const bucket = this.db.storage.from(CERTIFICATE_BUCKET);
    if (file) {
      const prepared = await prepareCertificate(file);
      path = `solicitudes/${id}/verificacion/${randomUUID()}.${prepared.extension}`;
      const upload = await bucket.upload(path, prepared.buffer, {
        contentType: prepared.mime,
        upsert: false,
      });
      if (upload.error) throw cohortError('SOLICITUD_ESCANEO_NO_DISPONIBLE');
      scan = { path, mime: prepared.mime, sha256: prepared.sha256, size: prepared.size };
    }
    const result = await this.db.rpc('register_request_verification_v2', {
      p_actor: actor,
      p_id: id,
      p_token: String(input.token),
      p_type: String(input.tipo),
      p_method: String(input.metodo),
      p_result: String(input.resultado),
      p_note: String(input.nota ?? ''),
      p_mode: String(input.mode),
      p_scan: scan,
    });
    if (result.error) {
      if (path) {
        const check = await this.db
          .from('solicitud_verificaciones')
          .select('id')
          .eq('scan_path', path)
          .maybeSingle();
        if (!check.error && !check.data) await bucket.remove([path]).catch(() => undefined);
      }
      throwStudentScheduleError(result.error);
    }
    return result.data;
  }
}
