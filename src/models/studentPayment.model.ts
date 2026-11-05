export type PaymentProviderName = 'simulado' | 'manual' | 'kushki';
export type PaymentState = 'pendiente' | 'rechazado' | 'aprobado' | 'revision';
export interface StudentPayment {
  id: string;
  reservationId: string | null;
  enrollmentId: string | null;
  proveedor: PaymentProviderName;
  estado: PaymentState;
  subtotalCentavos: number;
  recargoCentavos: number;
  ivaCentavos: number;
  totalCentavos: number;
  moneda: 'USD';
  createdAt: string;
  confirmedAt: string | null;
  serverNow: string;
  requiereRevision: boolean;
}
export interface PaymentRow extends Record<string, unknown> {
  id: string;
  student_id: string | null;
  enrollment_id: string | null;
  reservation_id: string | null;
  attempt_key: string;
  proveedor: PaymentProviderName;
  referencia: string | null;
  estado: PaymentState;
  subtotal_centavos: number;
  recargo_centavos: number;
  iva_centavos: number;
  total_centavos: number;
  moneda: 'USD';
  recibido_centavos: number | null;
  recibido_moneda: string | null;
  motivo_revision: string | null;
  actor_id: string | null;
  comprobante: string | null;
  dispatch_at: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}
