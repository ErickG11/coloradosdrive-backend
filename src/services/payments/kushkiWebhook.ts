import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentConfig } from '../../config/paymentConfig';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../config/database.types';
import { AppError } from '../../utils/AppError';
import { paymentDigest } from '../studentPayment.service';
import { throwStudentPaymentError } from '../../utils/studentPaymentError';
// Política oficial de reintentos: hasta3h;5min adicionales para tránsito/reloj.
const MAX_AGE_MS = 185 * 60_000;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('Evento inválido.', 400, { code: 'WEBHOOK_INVALIDO' });
  return value as Record<string, unknown>;
}
export interface VerifiedPaymentEvent {
  id: string | null;
  reference: string | null;
  result: 'aprobado' | 'rechazado';
  total: number;
  currency: string;
  event: string;
  hash: string;
}
export function verifyKushkiWebhook(
  config: PaymentConfig,
  headers: { key?: string; id?: string; signature?: string },
  body: unknown,
): VerifiedPaymentEvent {
  const canonical = JSON.stringify(body);
  const time = headers.id;
  const signature = headers.signature;
  const unauthorized = (): AppError =>
    new AppError('Firma de pago inválida.', 401, { code: 'FIRMA_PAGO_INVALIDA' });
  if (
    !config.KUSHKI_WEBHOOK_SECRET ||
    !config.KUSHKI_MERCHANT_ID ||
    !time ||
    !/^\d{10}(\d{3})?$/.test(time) ||
    !signature ||
    !/^[a-fA-F0-9]{64}$/.test(signature) ||
    headers.key !== config.KUSHKI_MERCHANT_ID ||
    !canonical
  )
    throw unauthorized();
  const timestamp = Number(time) * (time.length === 10 ? 1000 : 1);
  if (Date.now() - timestamp > MAX_AGE_MS || timestamp - Date.now() > 300_000) throw unauthorized();
  const computed = createHmac('sha256', config.KUSHKI_WEBHOOK_SECRET)
    .update(`${canonical}.${time}`)
    .digest();
  if (!timingSafeEqual(computed, Buffer.from(signature, 'hex'))) throw unauthorized();
  const data = object(body);
  // La ausencia o invalidez de metadata no invalida una firma: aún se puede
  // correlacionar por ticket con un pago Kushki propio.
  const metadata =
    data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : {};
  const candidate = metadata.drivePaymentId;
  const id =
    typeof candidate === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(candidate)
      ? candidate.toLowerCase()
      : null;
  const reference = data.ticket_number ?? null;
  if (
    (reference !== null &&
      (typeof reference !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(reference))) ||
    (data.transaction_status === 'APPROVAL' && reference === null) ||
    data.transaction_type !== 'SALE' ||
    !['APPROVAL', 'DECLINED'].includes(String(data.transaction_status)) ||
    (data.merchant_id !== undefined && data.merchant_id !== config.KUSHKI_MERCHANT_ID)
  )
    throw new AppError('Evento no corresponde a un pago.', 400, { code: 'WEBHOOK_INVALIDO' });
  const amount = object(data.amount);
  const components = ['subtotalIva0', 'subtotalIva', 'iva', 'ice'].map((k) => amount[k] ?? 0);
  if (components.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0))
    throw new AppError('Importe inválido.', 400, { code: 'WEBHOOK_INVALIDO' });
  const reported =
    data.transaction_status === 'DECLINED'
      ? (data.request_amount ?? data.approved_transaction_amount)
      : (data.approved_transaction_amount ?? data.request_amount);
  // Un importe presente con tipo inválido no se sustituye por el solicitado.
  // Sin ningún importe explícito tampoco se inventa un pago de cero.
  if (
    (reported !== undefined && (typeof reported !== 'number' || !Number.isFinite(reported))) ||
    (reported === undefined &&
      !['subtotalIva0', 'subtotalIva', 'iva', 'ice'].some((k) => amount[k] !== undefined))
  )
    throw new AppError('Importe notificado inválido.', 400, { code: 'WEBHOOK_INVALIDO' });

  const dollars =
    typeof reported === 'number'
      ? reported
      : components.reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  const total = Math.round(dollars * 100);
  const currency = amount.currency ?? data.currency_code;
  if (
    !Number.isFinite(dollars) ||
    Math.abs(dollars * 100 - total) > 0.0001 ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    total > 10001000000 ||
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency)
  )
    throw new AppError('Importe o moneda inválidos.', 400, { code: 'WEBHOOK_INVALIDO' });
  return {
    id,
    reference,
    result: data.transaction_status === 'APPROVAL' ? 'aprobado' : 'rechazado',
    total,
    currency,
    event: paymentDigest(
      `${time}.${reference ?? id ?? paymentDigest(canonical)}.${String(data.transaction_status)}`,
    ),
    hash: paymentDigest(canonical),
  };
}

export async function correlateKushkiPayment(
  db: SupabaseClient<Database>,
  event: Pick<VerifiedPaymentEvent, 'id' | 'reference'>,
): Promise<string | null> {
  if (event.id) {
    const payment = await db
      .from('payments')
      .select('id')
      .eq('proveedor', 'kushki')
      .eq('id', event.id)
      .maybeSingle();
    if (payment.error) throwStudentPaymentError(payment.error);
    if (payment.data) return payment.data.id;
  }
  if (!event.reference) return null;
  const payment = await db
    .from('payments')
    .select('id')
    .eq('proveedor', 'kushki')
    .eq('referencia', event.reference)
    .maybeSingle();
  if (payment.error) throwStudentPaymentError(payment.error);
  return payment.data?.id ?? null;
}
