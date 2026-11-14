import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { EmailService } from './email.service';
import { enrollmentRuleEnabled } from './enrollmentRuleFlags.service';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
export class RequestEmailService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly email: EmailService,
  ) {}
  async run(): Promise<void> {
    if (!(await enrollmentRuleEnabled(this.db, 'identity'))) return;
    for (let n = 0; n < 20; n++) {
      const claim = await this.db.rpc('claim_request_email_v2');
      if (claim.error) throwStudentScheduleError(claim.error);
      if (!claim.data) return;
      const event = claim.data;
      let sent = false;
      try {
        await this.email.sendRequestStateEmail(event);
        sent = true;
      } catch {
        sent = false;
      }
      const result = await this.db.rpc('finish_request_email_v2', {
        p_id: event.id,
        p_token: event.token,
        p_sent: sent,
      });
      if (result.error) throwStudentScheduleError(result.error);
    }
  }
}
