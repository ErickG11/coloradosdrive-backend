import type { StudentPayment } from '../../models/studentPayment.model';
export type ProviderResult = 'aprobado' | 'rechazado' | 'pendiente';
export interface PaymentContact {
  cedula: string;
  nombres: string;
  apellidos: string;
  correo: string;
  telefono?: string;
}
export interface ProviderOutcome {
  resultado: ProviderResult;
  referencia: string | null;
}
export interface PaymentProvider {
  charge(
    payment: StudentPayment,
    input: { token?: string; resultado?: ProviderResult; contact?: PaymentContact },
  ): Promise<ProviderOutcome>;
}
export class SimulatedPaymentProvider implements PaymentProvider {
  charge(payment: StudentPayment, input: { resultado?: ProviderResult }): Promise<ProviderOutcome> {
    return Promise.resolve({
      resultado: input.resultado ?? 'pendiente',
      referencia: `sim-${payment.id}`,
    });
  }
}
export class ManualPaymentProvider implements PaymentProvider {
  charge(payment: StudentPayment): Promise<ProviderOutcome> {
    return Promise.resolve({ resultado: 'aprobado', referencia: `cash-${payment.id}` });
  }
}
