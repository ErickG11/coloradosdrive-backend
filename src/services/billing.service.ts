import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { BillingPort } from './billing/billingPort';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { enrollmentRuleEnabled } from './enrollmentRuleFlags.service';
export class BillingService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly port: BillingPort,
  ) {}
  async run(): Promise<{ processed: number; failed: number }> {
    if (!(await enrollmentRuleEnabled(this.db, 'billing'))) return { processed: 0, failed: 0 };
    let processed = 0,
      failed = 0;
    for (let i = 0; i < 50; i++) {
      const claim = await this.db.rpc('claim_billing_v2');
      if (claim.error) throwStudentScheduleError(claim.error);
      if (!claim.data) break;
      let result: 'MANUAL_PENDING' | 'FAILED';
      try {
        result = await this.port.prepare(claim.data);
      } catch {
        result = 'FAILED';
        failed++;
      }
      const finish = await this.db.rpc('finish_billing_v2', {
        p_document: claim.data.id,
        p_token: claim.data.leaseToken,
        p_result: result,
      });
      if (finish.error) throwStudentScheduleError(finish.error);
      processed++;
    }
    return { processed, failed };
  }
}
