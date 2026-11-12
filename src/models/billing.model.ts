export interface BillingProfile {
  name: string;
  documentType: 'ruc' | 'cedula' | 'pasaporte' | 'otro';
  documentNumber: string;
  address: string;
  email: string;
}
export interface BillingDocument {
  id: string;
  paymentId: string;
  kind: 'invoice' | 'credit_note';
  state: 'queued' | 'processing' | 'manual_pending' | 'failed' | 'issued';
  amountCentavos: number;
  attempts: number;
  accessKey: string | null;
  authorization: string | null;
  authorizedAt: string | null;
  providerRuc: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
}
export interface BillingState {
  active: boolean;
  profile?: BillingProfile | null;
  serverNow?: string;
  documents?: BillingDocument[];
}
export interface BillingClaim {
  id: string;
  paymentId: string;
  kind: 'invoice' | 'credit_note';
  amountCentavos: number;
  payer: BillingProfile | null;
  leaseToken: string;
  idempotencyKey: string;
}
