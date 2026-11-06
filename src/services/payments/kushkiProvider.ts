import type { StudentPayment } from '../../models/studentPayment.model';
import type { PaymentConfig } from '../../config/paymentConfig';
import type { PaymentContact, PaymentProvider, ProviderOutcome } from './paymentProvider';
import { logSafeError } from '../../utils/safeLog';
import { AppError } from '../../utils/AppError';

// Fuentes oficiales EC en docs/operations/inscripcion-pagos-proveedores.md.
// Nunca tokeniza: solo recibe el token opaco de Hosted Fields del navegador.
export class KushkiPaymentProvider implements PaymentProvider {
  constructor(private readonly config: PaymentConfig) {}
  async charge(
    payment: StudentPayment,
    input: { token?: string; contact?: PaymentContact },
  ): Promise<ProviderOutcome> {
    if (!input.token || !input.contact)
      throw new AppError('Completa la tokenización de la tarjeta.', 400, {
        code: 'TOKEN_PAGO_REQUERIDO',
      });
    const base =
      this.config.KUSHKI_ENVIRONMENT === 'uat'
        ? 'https://api-uat.kushkipagos.com'
        : 'https://api.kushkipagos.com';
    try {
      const response = await fetch(`${base}/card/v1/charges`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': 'application/json',
          'Private-Merchant-Id': this.config.KUSHKI_PRIVATE_KEY,
        },
        body: JSON.stringify({
          token: input.token,
          amount: {
            subtotalIva: 0,
            subtotalIva0: payment.totalCentavos / 100,
            iva: 0,
            ice: 0,
            currency: 'USD',
          },
          contactDetails: {
            documentType: 'CI',
            documentNumber: input.contact.cedula,
            firstName: input.contact.nombres,
            lastName: input.contact.apellidos,
            email: input.contact.correo,
            ...(input.contact.telefono ? { phoneNumber: input.contact.telefono } : {}),
          },
          metadata: { drivePaymentId: payment.id },
        }),
      });
      // Un error/transporte incierto NO se traduce en rechazo ni en un segundo cobro.
      // El webhook firmado es quien confirma el resultado financiero.
      if (!response.ok) {
        logSafeError('kushki_charge_unconfirmed', { status: response.status });
        return { resultado: 'pendiente', referencia: null };
      }
      const body: unknown = await response.json();
      const ticket =
        body && typeof body === 'object' && 'ticketNumber' in body ? body.ticketNumber : null;
      return {
        resultado: 'pendiente',
        referencia:
          typeof ticket === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(ticket) ? ticket : null,
      };
    } catch (error) {
      logSafeError('kushki_charge_unconfirmed', error);
      return { resultado: 'pendiente', referencia: null };
    }
  }
}
