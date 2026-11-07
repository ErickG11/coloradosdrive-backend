import type { PaymentProviderName } from '../models/studentPayment.model';
export interface PaymentConfig {
  PAYMENT_PROVIDER: PaymentProviderName;
  PAYMENT_SURCHARGE_CENTS: number;
  KUSHKI_PUBLIC_KEY: string;
  KUSHKI_PRIVATE_KEY: string;
  KUSHKI_WEBHOOK_SECRET: string;
  KUSHKI_MERCHANT_ID: string;
  KUSHKI_ENVIRONMENT: 'uat' | 'production';
}
// IVA aún no definido por negocio: constante explícita, no una tasa fiscal inferida.
export const PAYMENT_VAT_CENTS = 0;
export function loadPaymentConfig(source: NodeJS.ProcessEnv): PaymentConfig {
  function text(name: string, fallback: string): string {
    const value = source[name]?.trim();
    return value === undefined || value === '' ? fallback : value;
  }
  const provider = text(
    'PAYMENT_PROVIDER',
    source.NODE_ENV === 'production' ? 'manual' : 'simulado',
  );
  if (provider !== 'simulado' && provider !== 'manual' && provider !== 'kushki')
    throw new Error('PAYMENT_PROVIDER debe ser simulado, manual o kushki');
  // Solo el modo demostración explícito permite el pago simulado en producción.
  if (provider === 'simulado' && source.NODE_ENV === 'production' && source.DEMO_MODE !== 'true')
    throw new Error('PAYMENT_PROVIDER=simulado está prohibido en NODE_ENV=production');
  const raw = text('PAYMENT_SURCHARGE_CENTS', '0');
  const surcharge = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(surcharge) || surcharge < 0 || surcharge > 1_000_000)
    throw new Error('PAYMENT_SURCHARGE_CENTS debe ser un entero entre0 y1000000');
  const environment = text('KUSHKI_ENVIRONMENT', 'uat');
  if (environment !== 'uat' && environment !== 'production')
    throw new Error('KUSHKI_ENVIRONMENT debe ser uat o production');
  function credential(name: string): string {
    const value = source[name]?.trim() ?? '';
    if (provider === 'kushki' && !value)
      throw new Error(`PAYMENT_PROVIDER=kushki requiere ${name}`);
    return value;
  }
  return {
    PAYMENT_PROVIDER: provider,
    PAYMENT_SURCHARGE_CENTS: surcharge,
    KUSHKI_ENVIRONMENT: environment,
    KUSHKI_PUBLIC_KEY: credential('KUSHKI_PUBLIC_KEY'),
    KUSHKI_PRIVATE_KEY: credential('KUSHKI_PRIVATE_KEY'),
    KUSHKI_WEBHOOK_SECRET: credential('KUSHKI_WEBHOOK_SECRET'),
    KUSHKI_MERCHANT_ID: credential('KUSHKI_MERCHANT_ID'),
  };
}
