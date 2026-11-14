import type { RequestHandler, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { enrollmentRuleEnabled } from '../services/enrollmentRuleFlags.service';
import { asyncHandler } from '../utils/asyncHandler';
import { translateCohortSqlError } from '../config/cohortErrors';
const money = new Set([
  'montototal',
  'montoabonado',
  'montoabonadoinicial',
  'descuento',
  'saldo',
  'preciobruto',
  'paidamountcentavos',
  'balance',
  'unpricedenrollments',
  'preciocentavos',
  'preciosnapshotcentavos',
  'paymentstatus',
  'recargocentavos',
  'totalcentavos',
  'subtotalcentavos',
  'recibidocentavos',
]);
export function restrictedFinancialResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restrictedFinancialResponse);
  if (!value || typeof value !== 'object') return value;
  if ('key' in value && value.key === 'payments')
    return {
      key: 'payments',
      label: 'Revisión financiera',
      fulfilled: false,
      detail: 'Información reservada al permiso de pagos y facturas.',
    };
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !money.has(key.replace(/_/g, '').toLowerCase()))
      .map(([key, item]) => [key, restrictedFinancialResponse(item)]),
  );
}
export const adminFinancialPrivacy: RequestHandler = asyncHandler(async (req, res, next) => {
  if (req.user?.role !== 'admin' || !(await enrollmentRuleEnabled(supabaseAdmin, 'permissions'))) {
    next();
    return;
  }
  const allowed = await supabaseAdmin.rpc('assert_enrollment_permission_v2', {
    p_actor: req.user.id,
    p_permission: 'view_payments_invoices',
  });
  if (!allowed.error) {
    next();
    return;
  }
  const error = translateCohortSqlError(allowed.error);
  if (error?.code !== 'PERMISO_REQUERIDO') throw allowed.error;
  const json = res.json.bind(res);
  res.json = (body: unknown): Response =>
    json(
      body && typeof body === 'object' && !Array.isArray(body)
        ? {
            ...(restrictedFinancialResponse(body) as Record<string, unknown>),
            financialRestricted: true,
          }
        : restrictedFinancialResponse(body),
    );
  next();
});
