import { Router, type Request, type RequestHandler } from 'express';
import { query, type ValidationChain } from 'express-validator';
import type { SupabaseClient } from '@supabase/supabase-js';

import { translateCohortSqlError } from '../config/cohortErrors';
import type { Database } from '../config/database.types';
import { env } from '../config/env';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { buildRateLimiter } from '../middlewares/rateLimit';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateFields } from '../middlewares/validate';
import {
  COURSE_TYPE_FILTERS,
  REPORT_FORMATS,
  REPORT_SELECTIONS,
  type ReportDocument,
  type ReportFilters,
  type ReportFormat,
} from '../models/report.model';
import { enrollmentRuleEnabled } from '../services/enrollmentRuleFlags.service';
import { ReportService, parseReportFilters } from '../services/report.service';
import { renderReportExcel } from '../services/reportExcel.service';
import { renderReportPdf } from '../services/reportPdf.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { ProcessingGate } from '../utils/processingGate';
import { reportFileName } from '../utils/reportFormat';
import { authenticatedUserId } from '../utils/requestUser';
import { logSafeError } from '../utils/safeLog';

// RF-08 · Reportes del administrador (CD-346; datos base de CD-345).
//   GET /admin/reportes           -> datos JSON de los reportes (vista previa / panel).
//   GET /admin/reportes/exportar  -> el mismo contenido en PDF o Excel.
// Ambos comparten ReportService: pantalla, PDF y Excel muestran las mismas cifras.
// Acceso: JWT + rol administrador (+ MFA de /admin/* cuando está exigido). El
// reporte financiero exige además el permiso de pagos y facturas si la regla
// de permisos está activa.

/** Ventana de los límites: 15 minutos (la de buildRateLimiter). */
export const REPORT_LIMITS = {
  /** Consultas JSON por administrador. */
  viewPerAdmin: 120,
  /** Exportaciones por administrador. */
  exportPerAdmin: 20,
  /** Exportaciones de toda la plataforma. */
  exportGlobal: 60,
  /** Exportaciones generándose a la vez en el proceso. */
  concurrent: 2,
  /** Espera máxima por un turno antes de responder 429. */
  queueWaitMs: 4000,
} as const;

const CONTENT_TYPES: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const FILTER_KEYS = ['desde', 'hasta', 'tipoCurso', 'cohorteId', 'tipo'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function filterValidators(extraKeys: string[] = []): ValidationChain[] {
  const allowed = [...FILTER_KEYS, ...extraKeys];
  return [
    query()
      .custom((value: Record<string, unknown>) =>
        Object.entries(value).every(
          ([key, item]) => allowed.includes(key) && typeof item === 'string',
        ),
      )
      .withMessage('La consulta incluye un parámetro no permitido'),
    query('desde')
      .exists()
      .withMessage('Indica la fecha inicial')
      .bail()
      .matches(DATE_RE)
      .withMessage('La fecha inicial debe tener el formato AAAA-MM-DD'),
    query('hasta')
      .exists()
      .withMessage('Indica la fecha final')
      .bail()
      .matches(DATE_RE)
      .withMessage('La fecha final debe tener el formato AAAA-MM-DD'),
    query('tipoCurso')
      .optional()
      .isIn([...COURSE_TYPE_FILTERS])
      .withMessage('El tipo de curso debe ser A, B o todos'),
    query('tipo')
      .optional()
      .isIn([...REPORT_SELECTIONS])
      .withMessage('El tipo de reporte no es válido'),
    query('cohorteId').optional().isUUID().withMessage('La cohorte seleccionada no es válida'),
  ];
}

export interface ReportRouterOptions {
  db?: SupabaseClient<Database>;
  service?: ReportService;
  /** Desactiva los límites de tasa (pruebas de integración generales). */
  skipLimits?: boolean;
  limits?: Partial<Record<'viewPerAdmin' | 'exportPerAdmin' | 'exportGlobal', number>>;
  gate?: ProcessingGate;
}

export function buildReportRouter(options: ReportRouterOptions = {}): Router {
  const db = options.db ?? supabaseAdmin;
  const service = options.service ?? new ReportService(db, () => new Date(), env.DEMO_MODE);
  const skip = options.skipLimits ?? env.NODE_ENV === 'test';
  const limits = { ...REPORT_LIMITS, ...options.limits };
  const gate =
    options.gate ?? new ProcessingGate(REPORT_LIMITS.concurrent, REPORT_LIMITS.queueWaitMs);
  // Los límites van después de authenticate: se cuentan por administrador, no por IP
  // (varios administradores pueden compartir la red de la escuela).
  const adminKey = (req: Request): string => `reportes:${req.user?.id ?? 'anon'}`;
  const viewLimiter = buildRateLimiter(limits.viewPerAdmin, skip, adminKey);
  const exportLimiter = buildRateLimiter(limits.exportPerAdmin, skip, adminKey);
  const exportGlobalLimiter = buildRateLimiter(limits.exportGlobal, skip, () => 'reportes:global');

  async function canViewFinance(actorId: string): Promise<boolean> {
    if (!(await enrollmentRuleEnabled(db, 'permissions'))) return true;
    const allowed = await db.rpc('assert_enrollment_permission_v2', {
      p_actor: actorId,
      p_permission: 'view_payments_invoices',
    });
    if (!allowed.error) return true;
    if (translateCohortSqlError(allowed.error)?.code !== 'PERMISO_REQUERIDO') throw allowed.error;
    return false;
  }

  async function build(
    req: Request,
  ): Promise<{ filters: ReportFilters; document: ReportDocument }> {
    const actorId = authenticatedUserId(req);
    const filters = parseReportFilters(req.query);
    const document = await service.build(filters, {
      id: actorId,
      canViewFinance: await canViewFinance(actorId),
    });
    return { filters, document };
  }

  // Cada exportación deja rastro: quién, qué tipo, formato, filtros y filas. Sin datos personales.
  async function audit(
    actorId: string,
    filters: ReportFilters,
    formato: ReportFormat,
    document: ReportDocument,
  ): Promise<void> {
    const { error } = await (db as unknown as SupabaseClient)
      .from('enrollment_domain_audit')
      .insert({
        actor_id: actorId,
        action: 'report_exported',
        entity_type: 'report',
        entity_id: filters.tipo,
        new_value: {
          formato,
          desde: filters.desde,
          hasta: filters.hasta,
          tipoCurso: filters.tipoCurso,
          cohorteId: filters.cohorteId,
          reportes: document.reports.map((report) => ({
            tipo: report.type,
            filas: report.rowCount,
          })),
          filas: document.reports.reduce((total, report) => total + report.rowCount, 0),
          omitidos: document.meta.omitted.map((item) => item.type),
          demo: document.meta.demoMode,
        },
        reason: 'Exportación de reporte (RF-08)',
      });
    if (error) {
      // Sin rastro no hay archivo: la trazabilidad es parte del requisito.
      logSafeError('report_export_audit_failed', error);
      throw new AppError('No se pudo registrar la exportación. Intenta de nuevo.', 503, {
        code: 'AUDITORIA_NO_DISPONIBLE',
      });
    }
  }

  const exportHandler: RequestHandler = asyncHandler(async (req, res) => {
    const formato = req.query.formato as ReportFormat;
    const started = Date.now();
    const result = await gate
      .run(async () => {
        const { filters, document } = await build(req);
        const buffer =
          formato === 'pdf' ? await renderReportPdf(document) : await renderReportExcel(document);
        await audit(authenticatedUserId(req), filters, formato, document);
        return {
          buffer,
          filters,
          rows: document.reports.reduce((total, report) => total + report.rowCount, 0),
        };
      })
      .catch((error: unknown) => {
        // Sin turno libre: demasiadas exportaciones simultáneas para este servidor.
        if (error instanceof AppError && error.code === 'PROCESAMIENTO_OCUPADO')
          throw new AppError(
            'Hay otras exportaciones en curso. Espera unos segundos y vuelve a intentarlo.',
            429,
            { code: 'EXPORTACION_OCUPADA' },
          );
        throw error;
      });
    // eslint-disable-next-line no-console -- medición de RNF-02, sin datos personales
    console.info(
      JSON.stringify({
        event: 'report_exported',
        formato,
        tipo: result.filters.tipo,
        filas: result.rows,
        bytes: result.buffer.length,
        ms: Date.now() - started,
      }),
    );
    // Nombre de archivo generado por el servidor; nunca con texto del usuario.
    const fileName = reportFileName(
      result.filters.tipo,
      result.filters.desde,
      result.filters.hasta,
      formato,
    );
    res
      .status(200)
      .set({
        'Content-Type': CONTENT_TYPES[formato],
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(result.buffer);
  });

  const router = Router();
  router.use(asyncHandler(authenticate), requireRole('admin'));
  router.get(
    '/',
    viewLimiter,
    filterValidators(),
    validateFields,
    asyncHandler(async (req, res) => {
      const { document } = await build(req);
      res.set('Cache-Control', 'no-store').json(document);
    }),
  );
  router.get(
    '/exportar',
    exportLimiter,
    exportGlobalLimiter,
    [
      ...filterValidators(['formato']),
      query('formato')
        .exists()
        .withMessage('Indica el formato de exportación')
        .bail()
        .isIn([...REPORT_FORMATS])
        .withMessage('El formato debe ser pdf o xlsx'),
    ],
    validateFields,
    exportHandler,
  );
  return router;
}

export const reportRouter = buildReportRouter();
