import type { BillingClaim } from '../../models/billing.model';
export interface BillingPort {
  prepare(document: BillingClaim): Promise<'MANUAL_PENDING'>;
}
/** No emite XML, no invoca SRI y nunca inventa una autorización. Proveedor aún no elegido. */
export class ManualBillingPort implements BillingPort {
  prepare(_document: BillingClaim): Promise<'MANUAL_PENDING'> {
    return Promise.resolve('MANUAL_PENDING');
  }
}
