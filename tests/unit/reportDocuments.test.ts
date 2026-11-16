import type { SupabaseClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';

import type { Database } from '../../src/config/database.types';
import {
  DEMO_REPORT_LABEL,
  EMPTY_REPORT_MESSAGE,
  type ReportDocument,
  type ReportFilters,
  type ReportTable,
} from '../../src/models/report.model';
import { ReportService } from '../../src/services/report.service';
import {
  EXCEL_FORMATS,
  excelValue,
  renderReportExcel,
} from '../../src/services/reportExcel.service';
import { pdfSafeText, renderReportPdf } from '../../src/services/reportPdf.service';
import { formatCell } from '../../src/utils/reportFormat';
import { pdfPageCount, pdfText } from '../helpers/pdfText';
import { IDS, NOVEMBER, createReportDb, sampleTables } from '../helpers/reportDb';

type Tables = ReturnType<typeof sampleTables>;
function build(
  overrides: Partial<ReportFilters> = {},
  tables: Tables = sampleTables(),
  demo = true,
): Promise<ReportDocument> {
  const db = createReportDb(tables);
  return new ReportService(
    db as unknown as SupabaseClient<Database>,
    () => new Date('2026-11-15T20:30:00Z'),
    demo,
  ).build(
    { ...NOVEMBER, tipoCurso: 'todos', cohorteId: null, tipo: 'todos', ...overrides },
    { id: IDS.admin, canViewFinance: true },
  );
}
async function open(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}
/** Fila del encabezado de la tabla: la que coincide con las etiquetas de columna. */
function headerRow(sheet: ExcelJS.Worksheet, table: ReportTable): number {
  for (let row = 1; row <= sheet.rowCount; row += 1)
    if (
      table.columns.every(
        (column, index) => sheet.getRow(row).getCell(index + 1).value === column.label,
      )
    )
      return row;
  throw new Error(`Sin encabezado en la hoja ${sheet.name}`);
}
const cellText = (cell: ExcelJS.Cell): string =>
  typeof cell.value === 'string' || typeof cell.value === 'number' ? String(cell.value) : '';
const columnA = (sheet: ExcelJS.Worksheet): string[] =>
  Array.from({ length: sheet.rowCount }, (_, index) =>
    cellText(sheet.getRow(index + 1).getCell(1)),
  );

describe('RF-08 · Excel', () => {
  it('es un .xlsx válido con una hoja por reporte y nombres de hoja válidos', async () => {
    const doc = await build();
    const buffer = await renderReportExcel(doc);
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    const workbook = await open(buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
      doc.reports.map((table) => table.sheetName),
    );
    expect(workbook.worksheets).toHaveLength(5);
    for (const sheet of workbook.worksheets) {
      expect(sheet.name.length).toBeLessThanOrEqual(31);
      expect(sheet.name).not.toMatch(/[\\/?*[\]:]/);
    }
  });

  it('cada hoja lleva los filtros aplicados arriba, panel congelado y autofiltro', async () => {
    const doc = await build({ tipoCurso: 'B', cohorteId: IDS.cohortB });
    const workbook = await open(await renderReportExcel(doc));
    for (const table of doc.reports) {
      const sheet = workbook.getWorksheet(table.sheetName);
      if (!sheet) throw new Error('Falta la hoja');
      const header = headerRow(sheet, table);
      const top = Array.from({ length: header - 1 }, (_, index) => {
        const row = sheet.getRow(index + 1);
        return `${cellText(row.getCell(1))}|${cellText(row.getCell(2))}`;
      });
      expect(top).toContain('Período|01/11/2026 al 30/11/2026 (hora de Ecuador)');
      expect(top).toContain('Tipo de curso|Tipo B');
      expect(top).toContain('Cohorte|Cohorte Vehículos Livianos Ñ');
      expect(top.some((line) => line.startsWith(`${DEMO_REPORT_LABEL}|`))).toBe(true);
      expect(top.some((line) => line.includes('Erick Peñafiel Muñoz (Administrador)'))).toBe(true);
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: header });
      expect(sheet.autoFilter).toBe(
        `A${String(header)}:${sheet.getColumn(table.columns.length).letter}${String(header + table.rows.length)}`,
      );
      expect(sheet.getRow(header).getCell(1).font).toMatchObject({ bold: true });
    }
  });

  it('las cifras son celdas numéricas con formato de moneda y de porcentaje (no texto)', async () => {
    const doc = await build();
    const workbook = await open(await renderReportExcel(doc));
    const finance = doc.reports.find((table) => table.type === 'finanzas');
    const attendance = doc.reports.find((table) => table.type === 'asistencia');
    if (!finance || !attendance) throw new Error('Faltan reportes');
    const financeSheet = workbook.getWorksheet(finance.sheetName);
    const attendanceSheet = workbook.getWorksheet(attendance.sheetName);
    if (!financeSheet || !attendanceSheet) throw new Error('Faltan hojas');
    const row = financeSheet.getRow(headerRow(financeSheet, finance) + 2);
    const cash = row.getCell(finance.columns.findIndex((c) => c.key === 'efectivo') + 1);
    expect(cash.type).toBe(ExcelJS.ValueType.Number);
    expect(cash.value).toBe(0.3);
    expect(cash.numFmt).toBe(EXCEL_FORMATS.money);
    const rate = attendanceSheet
      .getRow(headerRow(attendanceSheet, attendance) + 1)
      .getCell(attendance.columns.findIndex((c) => c.key === 'asistencia') + 1);
    expect(rate.type).toBe(ExcelJS.ValueType.Number);
    expect(rate.value).toBeCloseTo(2 / 3);
    expect(rate.numFmt).toBe(EXCEL_FORMATS.percent);
  });

  it('PARIDAD: cada cifra del Excel coincide con la del JSON, incluidos los totales', async () => {
    const doc = await build();
    const workbook = await open(await renderReportExcel(doc));
    let compared = 0;
    for (const table of doc.reports) {
      const sheet = workbook.getWorksheet(table.sheetName);
      if (!sheet) throw new Error('Falta la hoja');
      const header = headerRow(sheet, table);
      const lines = [...table.rows, ...(table.totals ? [table.totals] : [])];
      lines.forEach((line, rowIndex) => {
        table.columns.forEach((column, columnIndex) => {
          const cell = sheet.getRow(header + 1 + rowIndex).getCell(columnIndex + 1);
          const expected = line[column.key] ?? null;
          if (typeof expected === 'number') {
            expect(cell.type).toBe(ExcelJS.ValueType.Number);
            expect(cell.value).toBe(column.kind === 'money' ? expected / 100 : expected);
            compared += 1;
          } else if (expected !== null && expected !== '') expect(cell.value).toBe(expected);
        });
      });
      // Los indicadores también son numéricos y coinciden.
      const labels = columnA(sheet);
      for (const item of table.indicators) {
        const row = labels.indexOf(item.label) + 1;
        expect(row).toBeGreaterThan(0);
        expect(sheet.getRow(row).getCell(2).value).toBe(excelValue(item.value, item.kind));
      }
    }
    expect(compared).toBeGreaterThan(60);
  });

  it('neutraliza fórmulas en textos que vienen de la base', async () => {
    const tables = sampleTables();
    tables.cohorts[0].nombre = '=HYPERLINK("http://malo.example","clic")';
    tables.exams[0].title = '+SUM(1,2)';
    tables.users[1].nombre_completo = '@cmd';
    const doc = await build({}, tables);
    const workbook = await open(await renderReportExcel(doc));
    let formulas = 0;
    const texts: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.type === ExcelJS.ValueType.Formula) formulas += 1;
          if (typeof cell.value === 'string') texts.push(cell.value);
        });
      });
    });
    expect(formulas).toBe(0);
    expect(texts).toContain(`'=HYPERLINK("http://malo.example","clic")`);
    expect(texts).toContain("'+SUM(1,2)");
    expect(texts).toContain("'@cmd");
    expect(texts.filter((text) => /^[=+\-@\t\r]/.test(text))).toEqual([]);
  });

  it('sin datos: la hoja existe, conserva los filtros y dice «Sin datos para el período seleccionado»', async () => {
    const doc = await build({ desde: '2020-01-01', hasta: '2020-01-31' });
    const buffer = await renderReportExcel(doc);
    expect(buffer.length).toBeGreaterThan(1000);
    const workbook = await open(buffer);
    expect(workbook.worksheets).toHaveLength(5);
    workbook.eachSheet((sheet) => {
      const labels = columnA(sheet);
      expect(labels).toContain(EMPTY_REPORT_MESSAGE);
      expect(labels).toContain('Período');
    });
  });

  it('un valor sin dato se escribe como «—», nunca NaN ni Infinity', () => {
    expect(excelValue(null, 'percent')).toBe('—');
    expect(excelValue(Number.NaN, 'money')).toBe('—');
    expect(excelValue(Number.POSITIVE_INFINITY, 'decimal')).toBe('—');
    expect(excelValue(12345, 'money')).toBe(123.45);
    expect(excelValue(0.5, 'percent')).toBe(0.5);
  });
});

describe('RF-08 · PDF', () => {
  it('es un PDF válido con encabezado, filtros, quién lo generó, pie y numeración', async () => {
    const doc = await build();
    const pdf = await renderReportPdf(doc);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
    const pages = pdfPageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(5);
    const text = pdfText(pdf);
    expect(text).toContain('ColoradosDrive');
    expect(text).toContain('Reporte general de la escuela');
    expect(text).toContain('Generado el 15/11/2026 a las 15:30 (hora de Ecuador)');
    expect(text).toContain('Erick Peñafiel Muñoz (Administrador)');
    expect(text).toContain('Período: 01/11/2026 al 30/11/2026 (hora de Ecuador)');
    expect(text).toContain('Tipo de curso: Todos');
    expect(text).toContain('Documento confidencial de uso interno');
    expect(text).toContain(`Página 1 de ${String(pages)}`);
    expect(text).toContain(`Página ${String(pages)} de ${String(pages)}`);
    expect(text).toContain(DEMO_REPORT_LABEL);
  });

  it('conserva tildes y eñes', async () => {
    const text = pdfText(await renderReportPdf(await build()));
    for (const word of [
      'Cohorte Vehículos Livianos Ñ',
      'José Ñáñez Ibáñez',
      'María Güiza',
      'Examen teórico de señalización',
      'Matrículas por cohorte',
      'Aprobación de exámenes',
    ])
      expect(text).toContain(word);
  });

  it('PARIDAD: las cifras del PDF son las del JSON con el formato de presentación', async () => {
    const doc = await build();
    const text = pdfText(await renderReportPdf(doc));
    let compared = 0;
    for (const table of doc.reports) {
      for (const line of [...table.rows, ...(table.totals ? [table.totals] : [])])
        for (const column of table.columns) {
          const value = line[column.key] ?? null;
          if (typeof value !== 'number') continue;
          expect(text).toContain(pdfSafeText(formatCell(value, column.kind)));
          compared += 1;
        }
      for (const item of table.indicators)
        expect(text).toContain(pdfSafeText(formatCell(item.value, item.kind)));
    }
    expect(compared).toBeGreaterThan(60);
    // Cifras concretas del conjunto de ejemplo.
    expect(text).toContain('$400,40');
    expect(text).toContain('$299,60');
    expect(text).toContain('$0,30');
    expect(text).toContain('66,7 %');
  });

  it('sin datos: genera el documento con el aviso, no un archivo vacío', async () => {
    const pdf = await renderReportPdf(await build({ desde: '2020-01-01', hasta: '2020-01-31' }));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfPageCount(pdf)).toBeGreaterThanOrEqual(1);
    const text = pdfText(pdf);
    expect(text.split(EMPTY_REPORT_MESSAGE).length - 1).toBe(5);
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it('una tabla larga pasa de página y repite su encabezado; el texto largo no rompe el documento', async () => {
    const tables = sampleTables();
    const longName =
      'Cohorte con un nombre extraordinariamente largo para comprobar el ajuste de texto en la celda sin desbordar la página ni tapar las columnas vecinas';
    tables.cohorts = Array.from({ length: 90 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      nombre: index === 0 ? longName : `Cohorte número ${String(index)}`,
      course_id: IDS.courseB,
    }));
    tables.enrollments = tables.cohorts.map((cohort, index) => ({
      id: `e${String(index)}`,
      student_id: `s${String(index)}`,
      course_type: 'B',
      status: 'activo',
      cohort_id: cohort.id,
      monto_total: '200.00',
      monto_abonado: '0',
      fecha_inscripcion: '2026-11-10T15:00:00Z',
    }));
    const doc = await build({ tipo: 'matriculas' }, tables, false);
    expect(doc.reports[0].rows).toHaveLength(90);
    const pdf = await renderReportPdf(doc);
    const pages = pdfPageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(3);
    const text = pdfText(pdf);
    // El encabezado de la tabla aparece una vez por página de tabla.
    expect(text.split('Finalizadas').length - 1).toBeGreaterThanOrEqual(3);
    expect(text).toContain('Cohorte con un nombre');
    expect(text).not.toContain(DEMO_REPORT_LABEL);
  });

  it('sustituye caracteres que la fuente no puede dibujar en vez de fallar', async () => {
    expect(pdfSafeText('Línea\ncon\tsaltos')).toBe('Línea con saltos');
    expect(pdfSafeText('Ñandú «ok» — 100 %')).toBe('Ñandú «ok» — 100 %');
    expect(pdfSafeText('emoji 🚗 y 汉字')).not.toMatch(/🚗|汉/);
    const tables = sampleTables();
    tables.cohorts[0].nombre = 'Cohorte 🚗 汉字';
    await expect(renderReportPdf(await build({}, tables))).resolves.toBeInstanceOf(Buffer);
  });
});
