import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { throwStudentPaymentError } from '../utils/studentPaymentError';
import type { ReconciliationPort, ReconciliationResult } from './payments/reconciliationPort';
export class PaymentReconciliationService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly port: ReconciliationPort,
  ) {}
  async run(): Promise<number> {
    const correlationId = randomUUID();
    let reviewed = 0;
    for (let i = 0; i < 100; i++) {
      const claim = await this.db.rpc('claim_payment_reconciliation');
      if (claim.error) throwStudentPaymentError(claim.error);
      if (!claim.data) break;
      const { id, token, reference } = claim.data;
      let result: ReconciliationResult;
      try {
        result = await this.port.status({ paymentId: id, reference });
      } catch {
        result = 'CONSULTA_FALLIDA';
      }
      const finished = await this.db.rpc('finish_payment_reconciliation', {
        p_id: id,
        p_token: token,
        p_result: result,
      });
      if (finished.error) throwStudentPaymentError(finished.error);
      console.warn(
        JSON.stringify({
          correlationId,
          code: `PAGO_CONCILIACION_${result}`,
          entityId: id,
          lot: 3,
          operation: 'conciliar',
          result: finished.data ? 'registrado' : 'lease_perdida',
        }),
      );
      reviewed++;
    }
    return reviewed;
  }
}
