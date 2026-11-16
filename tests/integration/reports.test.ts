import express from 'express';
import ExcelJS from 'exceljs';
import request from 'supertest';

jest.mock('../../src/config/supabase', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const helper = require('../helpers/reportDb') as ReportDbHelper;
  const tables = helper.sampleTables();
  tables.users.push({
    id: 'test-user-id',
    nombre_completo: 'Administradora de Pruebas',
    rol: 'admin',
    activo: true,
  });
  return { supabaseAdmin: helper.createReportDb(tables), supabaseAnon: {} };
});
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
jest.mock('../../src/services/enrollmentRuleFlags.service', () => ({
  enrollmentRuleEnabled: jest.fn(),
}));

import { createApp } from '../../src/app';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { PUBLIC_ROUTE_ALLOWLIST } from '../../src/config/publicRoutes';
import { supabaseAdmin } from '../../src/config/supabase';
import { adminMfaGuard } from '../../src/middlewares/adminMfa.middleware';
import { errorHandler } from '../../src/middlewares/errorHandler';
import type { ReportDocument } from '../../src/models/report.model';
import { buildReportRouter } from '../../src/routes/report.routes';
import { enrollmentRuleEnabled } from '../../src/services/enrollmentRuleFlags.service';
import type { ReportService } from '../../src/services/report.service';
import { ProcessingGate } from '../../src/utils/processingGate';
import { formatCell } from '../../src/utils/reportFormat';
import { classifyRoutes, collectRoutes } from '../../src/utils/routeInventory';
import { pdfPageCount, pdfText } from '../helpers/pdfText';
import { IDS, type ReportDbFake } from '../helpers/reportDb';
import type * as ReportDbModule from '../helpers/reportDb';
import type * as ReportServiceModule from '../../src/services/report.service';
import { mockAuthToken } from '../helpers/tokens';

type ReportDbHelper = typeof ReportDbModule;
type ReportServiceHelper = typeof ReportServiceModule;

const app = createApp();
const db = supabaseAdmin as unknown as ReportDbFake;
const verify = verifySupabaseJwt as jest.Mock;
const ruleEnabled = enrollmentRuleEnabled as jest.Mock;
const auth = (role: 'estudiante' | 'admin' | 'instructor'): string =>
  `Bearer ${mockAuthToken(verify, role)}`;
const JSON_URL = '/admin/reportes';
const EXPORT_URL = '/admin/reportes/exportar';
const period = { desde: '2026-11-01', hasta: '2026-11-30' };
const binary = (
  res: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => {
    callback(null, Buffer.concat(chunks));
  });
};
const download = (query: Record<string, string>, role: 'admin' = 'admin'): request.Test =>
  request(app)
    .get(EXPORT_URL)
    .query(query)
    .set('Authorization', auth(role))
    .buffer(true)
    .parse(binary);

let infoSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  ruleEnabled.mockResolvedValue(false);
  db.rpc.mockResolvedValue({ data: null, error: null });
  for (const key of Object.keys(db.inserted)) Reflect.deleteProperty(db.inserted, key);
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  infoSpy.mockRestore();
  errorSpy.mockRestore();
  verify.mockReset();
});

describe('RF-08 / RNF-03 · control de acceso a los reportes', () => {
  const urls = [
    ['JSON', JSON_URL, period],
    ['exportación PDF', EXPORT_URL, { ...period, formato: 'pdf' }],
    ['exportación Excel', EXPORT_URL, { ...period, formato: 'xlsx' }],
  ] as const;

  it.each(urls)('%s: 401 sin token, sin revelar datos', async (_name, url, query) => {
    const res = await request(app).get(url).query(query);
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.stringify(res.body)).not.toMatch(/Cohorte|ingresos|reports/);
  });

  it.each(urls)('%s: 401 con token inválido', async (_name, url, query) => {
    verify.mockRejectedValueOnce(new Error('firma inválida'));
    const res = await request(app).get(url).query(query).set('Authorization', 'Bearer falso');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid or expired token');
  });

  it.each(urls)('%s: 403 para instructor', async (_name, url, query) => {
    const res = await request(app).get(url).query(query).set('Authorization', auth('instructor'));
    expect(res.status).toBe(403);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/Cohorte|ingresos|reports/);
  });

  it.each(urls)('%s: 403 para estudiante', async (_name, url, query) => {
    const res = await request(app).get(url).query(query).set('Authorization', auth('estudiante'));
    expect(res.status).toBe(403);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/Cohorte|ingresos|reports/);
  });

  it('el rechazo ocurre antes de leer datos de reportes y no deja auditoría', async () => {
    db.calls.length = 0;
    await request(app)
      .get(EXPORT_URL)
      .query({ ...period, formato: 'pdf' })
      .set('Authorization', auth('instructor'));
    expect(db.calls).not.toContain('payments');
    expect(db.calls).not.toContain('enrollments');
    expect(db.inserted.enrollment_domain_audit).toBeUndefined();
  });

  it('las rutas nuevas figuran como protegidas en el inventario de seguridad (RNF-03)', () => {
    const report = classifyRoutes(collectRoutes(app), PUBLIC_ROUTE_ALLOWLIST);
    const routes = report.routes.filter((route) => route.path.startsWith('/admin/reportes'));
    expect(routes.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
      'GET /admin/reportes',
      'GET /admin/reportes/exportar',
    ]);
    for (const route of routes) {
      expect(route.status).toBe('protected');
      expect(route.guards).toEqual(expect.arrayContaining(['authenticate', 'requireRole']));
    }
    expect(report.unprotected).toEqual([]);
  });

  it('con MFA exigido, un administrador sin segundo factor recibe 403 MFA_REQUERIDA', async () => {
    const guarded = express();
    guarded.use('/admin', adminMfaGuard(true));
    guarded.use('/admin/reportes', buildReportRouter({ skipLimits: true }));
    guarded.use(errorHandler);
    verify.mockResolvedValue({ sub: 'test-user-id', app_metadata: { role: 'admin' }, aal: 'aal1' });
    const blocked = await request(guarded)
      .get(EXPORT_URL)
      .query({ ...period, formato: 'pdf' })
      .set('Authorization', 'Bearer t');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MFA_REQUERIDA');
    verify.mockResolvedValue({ sub: 'test-user-id', app_metadata: { role: 'admin' }, aal: 'aal2' });
    const allowed = await request(guarded)
      .get(JSON_URL)
      .query(period)
      .set('Authorization', 'Bearer t');
    expect(allowed.status).toBe(200);
  });
});

describe('RF-08 · datos JSON', () => {
  it('200 para administrador con la estructura de reportes', async () => {
    const res = await request(app).get(JSON_URL).query(period).set('Authorization', auth('admin'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as ReportDocument;
    expect(body.reports.map((item) => item.type)).toEqual([
      'matriculas',
      'asistencia',
      'examenes',
      'finanzas',
      'instructores',
    ]);
    expect(body.meta.generatedBy).toEqual({
      name: 'Administradora de Pruebas',
      role: 'Administrador',
    });
    expect(JSON.stringify(body)).not.toMatch(/test-user@example\.com/);
  });

  it.each([
    [{ hasta: '2026-11-30' }, 'desde', 'Indica la fecha inicial'],
    [{ desde: '2026-11-01' }, 'hasta', 'Indica la fecha final'],
    [{ ...period, desde: '2026-11-31' }, 'desde', 'La fecha inicial no es una fecha válida'],
    [
      { desde: '2026-11-30', hasta: '2026-11-01' },
      'desde',
      'La fecha inicial no puede ser posterior a la fecha final',
    ],
    [
      { desde: '2024-01-01', hasta: '2026-01-01' },
      'hasta',
      'El período no puede superar 366 días. Acota las fechas.',
    ],
    [{ ...period, tipoCurso: 'C' }, 'tipoCurso', 'El tipo de curso debe ser A, B o todos'],
    [{ ...period, tipo: 'usuarios' }, 'tipo', 'El tipo de reporte no es válido'],
    [{ ...period, cohorteId: '123' }, 'cohorteId', 'La cohorte seleccionada no es válida'],
    [
      { ...period, cohorteId: '99999999-9999-4999-8999-999999999999' },
      'cohorteId',
      'La cohorte seleccionada no existe',
    ],
    [
      { ...period, cohorteId: IDS.cohortA, tipoCurso: 'B' },
      'cohorteId',
      'La cohorte seleccionada no pertenece al curso tipo B',
    ],
  ])('400 con mensaje claro para %p', async (query, field, message) => {
    const res = await request(app).get(JSON_URL).query(query).set('Authorization', auth('admin'));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
    expect(res.body.field).toBe(field);
  });

  it('400 ante parámetros desconocidos o repetidos', async () => {
    const extra = await request(app)
      .get(JSON_URL)
      .query({ ...period, orden: 'nombre' })
      .set('Authorization', auth('admin'));
    expect(extra.status).toBe(400);
    const repeated = await request(app)
      .get(`${JSON_URL}?desde=2026-11-01&desde=2026-11-02&hasta=2026-11-30`)
      .set('Authorization', auth('admin'));
    expect(repeated.status).toBe(400);
  });
});

describe('RF-08 · exportación', () => {
  it('PDF: 200, archivo válido, cabeceras seguras y nombre generado por el servidor', async () => {
    const res = await download({ ...period, formato: 'pdf', tipo: 'finanzas' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="reporte-finanzas-2026-11-01_2026-11-30.pdf"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const body = res.body as Buffer;
    expect(Number(res.headers['content-length'])).toBe(body.length);
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfPageCount(body)).toBeGreaterThanOrEqual(1);
    expect(pdfText(body)).toContain('Administradora de Pruebas (Administrador)');
  });

  it('Excel: 200 y se puede reabrir con una hoja por reporte', async () => {
    const res = await download({ ...period, formato: 'xlsx' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="reporte-todos-2026-11-01_2026-11-30.xlsx"',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Matrículas por cohorte',
      'Asistencia a prácticas',
      'Aprobación de exámenes',
      'Finanzas',
      'Ranking de instructores',
    ]);
  });

  it('CORS expone Content-Disposition al frontend permitido', async () => {
    const res = await download({ ...period, formato: 'pdf', tipo: 'matriculas' }).set(
      'Origin',
      'http://localhost:5173',
    );
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toContain('Content-Disposition');
  });

  it('PARIDAD: el PDF y el Excel exportados llevan las cifras del endpoint JSON', async () => {
    const filters = { ...period, tipoCurso: 'B' };
    const json = await request(app)
      .get(JSON_URL)
      .query(filters)
      .set('Authorization', auth('admin'));
    const pdf = await download({ ...filters, formato: 'pdf' });
    const xlsx = await download({ ...filters, formato: 'xlsx' });
    const doc = json.body as ReportDocument;
    const text = pdfText(pdf.body as Buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body);
    let compared = 0;
    for (const table of doc.reports) {
      const sheet = workbook.getWorksheet(table.sheetName);
      if (!sheet) throw new Error(`Falta la hoja ${table.sheetName}`);
      const numbers: number[] = [];
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'number') numbers.push(cell.value);
        });
      });
      for (const line of [...table.rows, ...(table.totals ? [table.totals] : [])])
        for (const column of table.columns) {
          const value = line[column.key];
          if (typeof value !== 'number') continue;
          expect(text).toContain(formatCell(value, column.kind));
          expect(numbers).toContain(column.kind === 'money' ? value / 100 : value);
          compared += 1;
        }
    }
    expect(compared).toBeGreaterThan(30);
    const finance = doc.reports.find((table) => table.type === 'finanzas');
    expect(finance?.totals).toMatchObject({ ingresos: 20030, saldoPendiente: 19970 });
  });

  it('sin datos: exporta un documento con el aviso, no un 500 ni un archivo vacío', async () => {
    const empty = { desde: '2020-01-01', hasta: '2020-01-31' };
    const pdf = await download({ ...empty, formato: 'pdf' });
    expect(pdf.status).toBe(200);
    expect(pdfText(pdf.body as Buffer)).toContain('Sin datos para el período seleccionado');
    const xlsx = await download({ ...empty, formato: 'xlsx' });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).length).toBeGreaterThan(1000);
  });

  it.each([
    [{ ...period }, 'formato', 'Indica el formato de exportación'],
    [{ ...period, formato: 'csv' }, 'formato', 'El formato debe ser pdf o xlsx'],
    [{ ...period, formato: 'pdf', tipo: '../etc' }, 'tipo', 'El tipo de reporte no es válido'],
    [
      { desde: '2026-11-30', hasta: '2026-11-01', formato: 'xlsx' },
      'desde',
      'La fecha inicial no puede ser posterior a la fecha final',
    ],
  ])('400 para %p y no genera archivo ni auditoría', async (query, field, message) => {
    const res = await request(app).get(EXPORT_URL).query(query).set('Authorization', auth('admin'));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
    expect(res.body.field).toBe(field);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(db.inserted.enrollment_domain_audit).toBeUndefined();
  });

  it('audita cada exportación: quién, tipo, formato, filtros y filas, sin datos personales', async () => {
    await download({ ...period, formato: 'xlsx', tipo: 'matriculas', tipoCurso: 'A' });
    expect(db.inserted.enrollment_domain_audit).toEqual([
      {
        actor_id: 'test-user-id',
        action: 'report_exported',
        entity_type: 'report',
        entity_id: 'matriculas',
        new_value: {
          formato: 'xlsx',
          desde: '2026-11-01',
          hasta: '2026-11-30',
          tipoCurso: 'A',
          cohorteId: null,
          reportes: [{ tipo: 'matriculas', filas: 1 }],
          filas: 1,
          omitidos: [],
          demo: false,
        },
        reason: 'Exportación de reporte (RF-08)',
      },
    ]);
    expect(JSON.stringify(db.inserted)).not.toMatch(/@|Administradora|nombre/);
  });

  it('la consulta JSON no deja auditoría de exportación', async () => {
    await request(app).get(JSON_URL).query(period).set('Authorization', auth('admin'));
    expect(db.inserted.enrollment_domain_audit).toBeUndefined();
  });

  it('si no se puede auditar, no entrega el archivo (503 sin detalles internos)', async () => {
    const helper = jest.requireActual<ReportDbHelper>('../helpers/reportDb');
    const failing = helper.createReportDb(helper.sampleTables(), { failInsert: true });
    const local = express();
    local.use('/admin/reportes', buildReportRouter({ db: failing as never, skipLimits: true }));
    local.use(errorHandler);
    const res = await request(local)
      .get(EXPORT_URL)
      .query({ ...period, formato: 'pdf' })
      .set('Authorization', auth('admin'));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AUDITORIA_NO_DISPONIBLE');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/42501|enrollment_domain_audit/);
  });
});

describe('RF-08 · permiso de pagos y facturas', () => {
  const denied = { data: null, error: { code: 'P7000', message: 'PERMISO_REQUERIDO' } };

  it('sin el permiso: 403 al pedir finanzas y se omite al pedir todos', async () => {
    ruleEnabled.mockResolvedValue(true);
    db.rpc.mockResolvedValue(denied);
    const finance = await request(app)
      .get(EXPORT_URL)
      .query({ ...period, formato: 'pdf', tipo: 'finanzas' })
      .set('Authorization', auth('admin'));
    expect(finance.status).toBe(403);
    expect(finance.body.code).toBe('PERMISO_REQUERIDO');
    expect(db.rpc).toHaveBeenCalledWith('assert_enrollment_permission_v2', {
      p_actor: 'test-user-id',
      p_permission: 'view_payments_invoices',
    });
    const all = await request(app).get(JSON_URL).query(period).set('Authorization', auth('admin'));
    expect(all.status).toBe(200);
    const body = all.body as ReportDocument;
    expect(body.reports.map((item) => item.type)).not.toContain('finanzas');
    expect(body.meta.omitted.map((item) => item.type)).toEqual(['finanzas']);
    expect(JSON.stringify(body)).not.toMatch(/saldoPendiente|"ingresos"/);
  });

  it('con el permiso concedido incluye finanzas', async () => {
    ruleEnabled.mockResolvedValue(true);
    db.rpc.mockResolvedValue({ data: true, error: null });
    const res = await request(app)
      .get(JSON_URL)
      .query({ ...period, tipo: 'finanzas' })
      .set('Authorization', auth('admin'));
    expect(res.status).toBe(200);
    expect((res.body as ReportDocument).reports[0].type).toBe('finanzas');
  });
});

describe('RF-08 · límites de abuso y carga', () => {
  function limitedApp(options: Parameters<typeof buildReportRouter>[0]): express.Express {
    const local = express();
    local.use('/admin/reportes', buildReportRouter({ skipLimits: false, ...options }));
    local.use(errorHandler);
    return local;
  }
  const asAdmin = (sub: string): void => {
    verify.mockResolvedValue({ sub, app_metadata: { role: 'admin' } });
  };
  const exportPdf = (target: express.Express): request.Test =>
    request(target)
      .get(EXPORT_URL)
      .query({ ...period, formato: 'pdf', tipo: 'matriculas' })
      .set('Authorization', 'Bearer t');

  it('429 al superar las exportaciones por administrador, sin afectar a otro administrador', async () => {
    const local = limitedApp({ limits: { exportPerAdmin: 2, exportGlobal: 50 } });
    asAdmin('admin-uno');
    expect((await exportPdf(local)).status).toBe(200);
    expect((await exportPdf(local)).status).toBe(200);
    const blocked = await exportPdf(local);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('LIMITE_PETICIONES');
    expect(blocked.body.message).toMatch(/Demasiadas solicitudes/);
    expect(blocked.headers['content-disposition']).toBeUndefined();
    asAdmin('admin-dos');
    expect((await exportPdf(local)).status).toBe(200);
  });

  it('429 al superar el límite global de exportaciones', async () => {
    const local = limitedApp({ limits: { exportPerAdmin: 50, exportGlobal: 2 } });
    asAdmin('admin-uno');
    expect((await exportPdf(local)).status).toBe(200);
    asAdmin('admin-dos');
    expect((await exportPdf(local)).status).toBe(200);
    asAdmin('admin-tres');
    expect((await exportPdf(local)).status).toBe(429);
  });

  it('las peticiones sin autenticar no consumen el cupo de exportación', async () => {
    const local = limitedApp({ limits: { exportPerAdmin: 1, exportGlobal: 50 } });
    verify.mockRejectedValue(new Error('token inválido'));
    for (let attempt = 0; attempt < 3; attempt += 1)
      expect((await exportPdf(local)).status).toBe(401);
    asAdmin('admin-uno');
    expect((await exportPdf(local)).status).toBe(200);
  });

  it('429 claro cuando hay demasiadas exportaciones simultáneas', async () => {
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = jest.requireActual<ReportServiceHelper>('../../src/services/report.service');
    const inner = new real.ReportService(supabaseAdmin);
    const slow = {
      build: async (...args: Parameters<ReportService['build']>) => {
        await waiting;
        return inner.build(...args);
      },
    } as unknown as ReportService;
    const local = limitedApp({
      skipLimits: true,
      service: slow,
      gate: new ProcessingGate(1, 20),
    });
    asAdmin('admin-uno');
    const first = exportPdf(local).then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = await exportPdf(local);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('EXPORTACION_OCUPADA');
    expect(second.body.message).toMatch(/otras exportaciones en curso/);
    release();
    expect((await first).status).toBe(200);
  });
});
