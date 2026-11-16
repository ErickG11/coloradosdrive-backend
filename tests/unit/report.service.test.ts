import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import type {
  ReportDocument,
  ReportFilters,
  ReportTable,
  ReportType,
} from '../../src/models/report.model';
import {
  REPORT_MAX_RANGE_DAYS,
  REPORT_MAX_SOURCE_ROWS,
  ReportService,
  parseReportFilters,
  reportPeriod,
} from '../../src/services/report.service';
import { AppError } from '../../src/utils/AppError';
import { IDS, NOVEMBER, createReportDb, sampleTables } from '../helpers/reportDb';

type Tables = ReturnType<typeof sampleTables>;
const NOW = new Date('2026-11-15T20:30:00Z');
const filters = (overrides: Partial<ReportFilters> = {}): ReportFilters => ({
  ...NOVEMBER,
  tipoCurso: 'todos',
  cohorteId: null,
  tipo: 'todos',
  ...overrides,
});
function build(
  overrides: Partial<ReportFilters> = {},
  options: { tables?: Tables; canViewFinance?: boolean; demo?: boolean; failTable?: string } = {},
): Promise<ReportDocument> & { db?: never } {
  const db = createReportDb(options.tables ?? sampleTables(), { failTable: options.failTable });
  const service = new ReportService(
    db as unknown as SupabaseClient<Database>,
    () => NOW,
    options.demo ?? false,
  );
  return service.build(filters(overrides), {
    id: IDS.admin,
    canViewFinance: options.canViewFinance ?? true,
  });
}
const report = (doc: ReportDocument, type: ReportType): ReportTable => {
  const found = doc.reports.find((item) => item.type === type);
  if (!found) throw new Error(`Falta el reporte ${type}`);
  return found;
};
const indicator = (table: ReportTable, label: string): unknown =>
  table.indicators.find((item) => item.label === label)?.value;
async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('Se esperaba un rechazo');
}

describe('RF-08 · validación de filtros en el servidor', () => {
  const valid = { desde: '2026-11-01', hasta: '2026-11-30' };

  it('acepta filtros válidos y aplica los valores por defecto', () => {
    expect(parseReportFilters(valid)).toEqual({
      ...valid,
      tipoCurso: 'todos',
      cohorteId: null,
      tipo: 'todos',
    });
    expect(
      parseReportFilters({ ...valid, tipoCurso: 'A', tipo: 'finanzas', cohorteId: IDS.cohortA }),
    ).toMatchObject({ tipoCurso: 'A', tipo: 'finanzas', cohorteId: IDS.cohortA });
  });

  it.each([
    [{ hasta: '2026-11-30' }, 'desde'],
    [{ desde: '2026-11-01' }, 'hasta'],
    [{ ...valid, desde: '01/11/2026' }, 'desde'],
    [{ ...valid, desde: '2026-02-30' }, 'desde'],
    [{ ...valid, hasta: '2026-13-01' }, 'hasta'],
    [{ ...valid, desde: '1999-12-31' }, 'desde'],
    [{ desde: '2026-12-01', hasta: '2026-11-30' }, 'desde'],
    [{ ...valid, tipoCurso: 'C' }, 'tipoCurso'],
    [{ ...valid, tipo: 'usuarios' }, 'tipo'],
    [{ ...valid, cohorteId: 'no-es-uuid' }, 'cohorteId'],
    [{ ...valid, cohorteId: "'; drop table users; --" }, 'cohorteId'],
    [{ ...valid, desde: ['2026-11-01'] }, 'desde'],
  ])('rechaza %p señalando el campo %s', (raw, field) => {
    const call = (): unknown => parseReportFilters(raw);
    expect(call).toThrow(AppError);
    try {
      call();
    } catch (error) {
      expect((error as AppError).statusCode).toBe(400);
      expect((error as AppError).field).toBe(field);
    }
  });

  it('limita el período a un año civil', () => {
    expect(() => parseReportFilters({ desde: '2026-01-01', hasta: '2026-12-31' })).not.toThrow();
    expect(() => parseReportFilters({ desde: '2024-01-01', hasta: '2024-12-31' })).not.toThrow();
    expect(REPORT_MAX_RANGE_DAYS).toBe(366);
    expect(() => parseReportFilters({ desde: '2025-01-01', hasta: '2026-01-02' })).toThrow(
      /no puede superar 366 días/,
    );
  });
});

describe('RF-08 · período en America/Guayaquil', () => {
  it('va de las 00:00:00 del primer día a las 23:59:59 del último, hora de Ecuador', () => {
    const period = reportPeriod('2026-11-01', '2026-11-30');
    expect(period.fromIso).toBe('2026-11-01T05:00:00.000Z');
    expect(period.toIso).toBe('2026-12-01T05:00:00.000Z');
  });

  it('un solo día abarca exactamente 24 horas locales', () => {
    const period = reportPeriod('2026-11-15', '2026-11-15');
    expect(period.to.toMillis() - period.from.toMillis()).toBe(24 * 3600 * 1000);
  });
});

describe('RF-08 · reportes', () => {
  it('devuelve los cinco reportes con metadatos y filtros legibles', async () => {
    const doc = await build({}, { demo: true });
    expect(doc.reports.map((item) => item.type)).toEqual([
      'matriculas',
      'asistencia',
      'examenes',
      'finanzas',
      'instructores',
    ]);
    expect(doc.meta.generatedBy).toEqual({ name: 'Erick Peñafiel Muñoz', role: 'Administrador' });
    expect(doc.meta.generatedAt.startsWith('2026-11-15T15:30:00')).toBe(true);
    expect(doc.meta.timezone).toBe('America/Guayaquil');
    expect(doc.meta.demoMode).toBe(true);
    expect(doc.meta.filterSummary).toEqual([
      { label: 'Período', value: '01/11/2026 al 30/11/2026 (hora de Ecuador)' },
      { label: 'Tipo de curso', value: 'Todos' },
      { label: 'Cohorte', value: 'Todas' },
      { label: 'Reporte', value: 'Todos' },
    ]);
    const names = doc.reports.map((item) => item.sheetName);
    expect(new Set(names).size).toBe(5);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/[\\/?*[\]:]/);
    }
  });

  it('matrículas: cuenta por cohorte, tipo y estado respetando los bordes del día', async () => {
    const table = report(await build({ tipo: 'matriculas' }), 'matriculas');
    expect(table.rows).toEqual([
      {
        cohorte: 'Cohorte Motocicleta Noviembre',
        tipoCurso: 'Tipo A',
        activas: 2,
        pendientes: 0,
        finalizadas: 0,
        retiradas: 0,
        anuladas: 0,
        total: 2,
      },
      {
        cohorte: 'Cohorte Vehículos Livianos Ñ',
        tipoCurso: 'Tipo B',
        activas: 1,
        pendientes: 0,
        finalizadas: 1,
        retiradas: 1,
        anuladas: 0,
        total: 3,
      },
      {
        cohorte: 'Sin cohorte',
        tipoCurso: 'Tipo B',
        activas: 0,
        pendientes: 1,
        finalizadas: 0,
        retiradas: 0,
        anuladas: 0,
        total: 1,
      },
    ]);
    // 30/11 23:59:59 entra; 01/12 00:00:00 y 31/10 23:59:59 quedan fuera.
    expect(table.totals).toMatchObject({ activas: 3, pendientes: 1, total: 6 });
    expect(indicator(table, 'Tipo A')).toBe(2);
    expect(indicator(table, 'Tipo B')).toBe(4);
  });

  it('asistencia: asistidas, faltas, horas y porcentaje', async () => {
    const table = report(await build({ tipo: 'asistencia' }), 'asistencia');
    expect(table.rows).toEqual([
      {
        cohorte: 'Cohorte Motocicleta Noviembre',
        tipoCurso: 'Tipo A',
        asistidas: 2,
        faltas: 1,
        registradas: 3,
        horasAsistidas: 2,
        asistencia: 2 / 3,
      },
      {
        cohorte: 'Cohorte Vehículos Livianos Ñ',
        tipoCurso: 'Tipo B',
        asistidas: 1,
        faltas: 0,
        registradas: 1,
        horasAsistidas: 1,
        asistencia: 1,
      },
    ]);
    expect(table.totals).toMatchObject({
      asistidas: 3,
      faltas: 1,
      horasAsistidas: 3,
      asistencia: 0.75,
    });
  });

  it('exámenes: intentos finalizados, aprobados y tasa por examen', async () => {
    const table = report(await build({ tipo: 'examenes' }), 'examenes');
    expect(table.rows).toEqual([
      {
        examen: 'Examen teórico de señalización',
        tipoCurso: 'Tipo A',
        tipoExamen: 'Definitivo',
        intentos: 3,
        aprobados: 2,
        reprobados: 1,
        aprobacion: 2 / 3,
        notaPromedio: 75.17,
      },
      {
        examen: 'Simulacro de conducción',
        tipoCurso: 'Tipo B',
        tipoExamen: 'Práctica',
        intentos: 1,
        aprobados: 1,
        reprobados: 0,
        aprobacion: 1,
        notaPromedio: 100,
      },
    ]);
    expect(table.totals).toMatchObject({
      intentos: 4,
      aprobados: 3,
      reprobados: 1,
      aprobacion: 0.75,
    });
    expect(indicator(table, 'Aprobación en exámenes definitivos')).toBeCloseTo(2 / 3);
  });

  it('finanzas: solo pagos aprobados del período, por fecha de confirmación y en centavos enteros', async () => {
    const table = report(await build({ tipo: 'finanzas' }), 'finanzas');
    expect(table.rows).toEqual([
      {
        cohorte: 'Cohorte Motocicleta Noviembre',
        tipoCurso: 'Tipo A',
        pagos: 2,
        enLinea: 15000,
        efectivo: 5010,
        ingresos: 20010,
        simulados: 0,
        saldoPendiente: 9990,
      },
      {
        cohorte: 'Cohorte Vehículos Livianos Ñ',
        tipoCurso: 'Tipo B',
        pagos: 3,
        enLinea: 20000,
        efectivo: 30,
        ingresos: 20030,
        simulados: 20000,
        saldoPendiente: 19970,
      },
    ]);
    // El pago del 01/12 00:00 (matrícula de noviembre) pertenece a diciembre.
    expect(table.totals).toMatchObject({
      pagos: 5,
      ingresos: 40040,
      simulados: 20000,
      saldoPendiente: 29960,
    });
    for (const row of table.rows)
      for (const key of ['enLinea', 'efectivo', 'ingresos', 'simulados', 'saldoPendiente'])
        expect(Number.isInteger(row[key])).toBe(true);
    expect(indicator(table, 'Ingresos confirmados')).toBe(40040);
    expect(indicator(table, 'Pagos simulados (excluidos)')).toBe(20000);
    expect(table.notes.join(' ')).toMatch(/fecha de confirmación del pago/);
    expect(table.notes.join(' ')).toMatch(/no suman a los ingresos confirmados/);
  });

  it('finanzas: sin pagos simulados y sin modo demostración no aparece esa columna', async () => {
    const tables = sampleTables();
    tables.payments = tables.payments.filter((payment) => payment.proveedor !== 'simulado');
    const table = report(await build({ tipo: 'finanzas' }, { tables }), 'finanzas');
    expect(table.columns.map((column) => column.key)).not.toContain('simulados');
    expect(table.totals).toMatchObject({ ingresos: 40040 });
  });

  it('finanzas: el pago de diciembre cuenta en diciembre aunque la matrícula sea de noviembre', async () => {
    const table = report(
      await build({ tipo: 'finanzas', desde: '2026-12-01', hasta: '2026-12-31' }),
      'finanzas',
    );
    expect(table.totals).toMatchObject({ pagos: 1, ingresos: 9990 });
  });

  it('ranking de instructores: promedio, desglose por estrellas y mínimo de calificaciones', async () => {
    const table = report(await build({ tipo: 'instructores' }), 'instructores');
    expect(table.rows).toEqual([
      {
        posicion: 1,
        instructor: 'José Ñáñez Ibáñez',
        estado: 'Activo',
        promedio: 4,
        calificaciones: 4,
        estrellas5: 2,
        estrellas4: 1,
        estrellas3: 0,
        estrellas2: 1,
        estrellas1: 0,
        observacion: '',
      },
      {
        posicion: 2,
        instructor: 'María Güiza',
        estado: 'Inactivo',
        promedio: 5,
        calificaciones: 1,
        estrellas5: 1,
        estrellas4: 0,
        estrellas3: 0,
        estrellas2: 0,
        estrellas1: 0,
        observacion: 'Pocas calificaciones',
      },
    ]);
    // La anulada y la de una práctica «no asistió» no cuentan.
    expect(table.totals).toMatchObject({ calificaciones: 5, promedio: 4.2 });
  });

  it('respeta el filtro por tipo de curso en todos los reportes', async () => {
    const doc = await build({ tipoCurso: 'A' });
    expect(report(doc, 'matriculas').totals).toMatchObject({ total: 2 });
    expect(report(doc, 'asistencia').totals).toMatchObject({ registradas: 3 });
    expect(report(doc, 'examenes').totals).toMatchObject({ intentos: 3 });
    expect(report(doc, 'finanzas').totals).toMatchObject({ ingresos: 20010, saldoPendiente: 9990 });
    expect(report(doc, 'instructores').totals).toMatchObject({ calificaciones: 1 });
    expect(doc.meta.filterSummary[1]).toEqual({ label: 'Tipo de curso', value: 'Tipo A' });
  });

  it('respeta el filtro por cohorte y lo nombra en los filtros', async () => {
    const doc = await build({ cohorteId: IDS.cohortB });
    expect(report(doc, 'matriculas').rows).toHaveLength(1);
    expect(report(doc, 'matriculas').totals).toMatchObject({ total: 3 });
    expect(report(doc, 'asistencia').totals).toMatchObject({ asistidas: 1 });
    expect(report(doc, 'examenes').rows.map((row) => row.examen)).toEqual([
      'Simulacro de conducción',
    ]);
    expect(report(doc, 'finanzas').totals).toMatchObject({ ingresos: 20030 });
    expect(report(doc, 'instructores').totals).toMatchObject({ calificaciones: 4 });
    expect(doc.meta.filterSummary[2]).toEqual({
      label: 'Cohorte',
      value: 'Cohorte Vehículos Livianos Ñ',
    });
  });

  it('con un período sin datos responde reportes vacíos, sin NaN ni Infinity', async () => {
    const doc = await build({ desde: '2020-01-01', hasta: '2020-01-31' });
    for (const table of doc.reports) {
      expect(table.rows).toEqual([]);
      expect(table.totals).toBeNull();
      expect(table.chart).toBeNull();
      expect(table.rowCount).toBe(0);
    }
    expect(JSON.stringify(doc)).not.toMatch(/NaN|Infinity/);
    expect(indicator(report(doc, 'asistencia'), 'Asistencia')).toBeNull();
    expect(indicator(report(doc, 'examenes'), 'Aprobación general')).toBeNull();
    expect(indicator(report(doc, 'instructores'), 'Promedio general')).toBeNull();
  });

  it('con la base vacía también responde sin fallar', async () => {
    const doc = await build({}, { tables: { users: [] } as unknown as Tables });
    expect(doc.reports).toHaveLength(5);
    expect(doc.meta.generatedBy.name).toBe('Administrador');
  });
});

describe('RF-08 · reglas de acceso, coherencia y límites', () => {
  it('rechaza una cohorte inexistente con 400', async () => {
    const error = await rejection(build({ cohorteId: '99999999-9999-4999-8999-999999999999' }));
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('COHORTE_NO_ENCONTRADA');
    expect(error.message).toBe('La cohorte seleccionada no existe');
  });

  it('rechaza una cohorte que no corresponde al tipo de curso con 400', async () => {
    const error = await rejection(build({ cohorteId: IDS.cohortA, tipoCurso: 'B' }));
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('COHORTE_TIPO_INCOHERENTE');
    expect(error.field).toBe('cohorteId');
  });

  it('vuelve a validar los filtros aunque lleguen ya tipados', async () => {
    const error = await rejection(build({ desde: '2026-12-01', hasta: '2026-11-01' }));
    expect(error.statusCode).toBe(400);
  });

  it('sin permiso financiero: 403 si se pide finanzas; se omite con aviso si se piden todos', async () => {
    const error = await rejection(build({ tipo: 'finanzas' }, { canViewFinance: false }));
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('PERMISO_REQUERIDO');
    const doc = await build({}, { canViewFinance: false });
    expect(doc.reports.map((item) => item.type)).toEqual([
      'matriculas',
      'asistencia',
      'examenes',
      'instructores',
    ]);
    expect(doc.meta.omitted).toEqual([
      { type: 'finanzas', reason: 'Finanzas: reservado al permiso de pagos y facturas.' },
    ]);
    expect(JSON.stringify(doc)).not.toMatch(/ingresos|saldoPendiente/);
  });

  it('pide acotar los filtros (413) si el volumen supera el tope', async () => {
    const tables = sampleTables();
    tables.enrollments = Array.from({ length: REPORT_MAX_SOURCE_ROWS + 1 }, (_, index) => ({
      id: `e${String(index)}`,
      student_id: `s${String(index)}`,
      course_type: 'B',
      status: 'activo',
      cohort_id: IDS.cohortB,
      monto_total: '200.00',
      monto_abonado: '0',
      fecha_inscripcion: '2026-11-10T15:00:00Z',
    }));
    const error = await rejection(build({ tipo: 'matriculas' }, { tables }));
    expect(error.statusCode).toBe(413);
    expect(error.code).toBe('REPORTE_DEMASIADOS_DATOS');
    expect(error.message).toMatch(/Acota el rango de fechas/);
  });

  it('pagina las lecturas: más de una página se suma completa', async () => {
    const tables = sampleTables();
    tables.enrollments = Array.from({ length: 2500 }, (_, index) => ({
      id: `e${String(index)}`,
      student_id: `s${String(index)}`,
      course_type: 'A',
      status: 'activo',
      cohort_id: IDS.cohortA,
      monto_total: '150.00',
      monto_abonado: '149.99',
      fecha_inscripcion: '2026-11-10T15:00:00Z',
    }));
    const doc = await build({}, { tables });
    expect(report(doc, 'matriculas').totals).toMatchObject({ total: 2500 });
    expect(report(doc, 'finanzas').totals).toMatchObject({ saldoPendiente: 2500 });
  });

  it('un fallo de lectura responde 503 sin detalles internos', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = await rejection(build({ tipo: 'finanzas' }, { failTable: 'payments' }));
    expect(error.statusCode).toBe(503);
    expect(error.message).not.toMatch(/payments|XX000|sql/i);
    spy.mockRestore();
  });

  it('no hace consultas por fila (sin N+1): el número de consultas no depende del volumen', async () => {
    const count = async (tables: Tables): Promise<number> => {
      const db = createReportDb(tables);
      const service = new ReportService(db as unknown as SupabaseClient<Database>, () => NOW);
      await service.build(filters(), { id: IDS.admin, canViewFinance: true });
      return db.calls.length;
    };
    const big = sampleTables();
    big.cohorts = Array.from({ length: 60 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      nombre: `Cohorte ${String(index)}`,
      course_id: IDS.courseB,
    }));
    expect(await count(big)).toBe(await count(sampleTables()));
  });

  it('privacidad: no salen cédulas, correos, teléfonos ni identificadores de alumnos', async () => {
    const tables = sampleTables();
    tables.users.push({
      id: '30000000-0000-4000-8000-000000000001',
      nombre_completo: 'Alumno Privado',
      rol: 'estudiante',
      activo: true,
      cedula: '1712345678',
      telefono: '0991234567',
      email: 'alumno@example.com',
    });
    const text = JSON.stringify(await build({}, { tables }));
    expect(text).not.toMatch(/1712345678|0991234567|alumno@example\.com|Alumno Privado/);
    expect(text).not.toMatch(/30000000-0000-4000-8000/);
    expect(text).not.toMatch(/student_id|studentId|cedula|telefono|email|password|token/i);
  });
});
