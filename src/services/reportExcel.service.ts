import ExcelJS from 'exceljs';
import { DateTime } from 'luxon';

import {
  CONFIDENTIALITY_LEGEND,
  DEMO_REPORT_LABEL,
  EMPTY_REPORT_MESSAGE,
  type ReportCell,
  type ReportCellKind,
  type ReportDocument,
  type ReportTable,
} from '../models/report.model';
import { EMPTY_VALUE, neutralizeFormula, safeSheetName } from '../utils/reportFormat';

// RF-08 · Excel con ExcelJS 4.4: una hoja por reporte. Las cifras son celdas
// numéricas reales (moneda y porcentaje con formato), nunca texto. Todo texto
// pasa por neutralizeFormula para impedir la inyección de fórmulas.

const RED = 'FFB42323';
const SOFT_RED = 'FFFBECEC';
const MUTED = 'FF566171';
export const EXCEL_FORMATS: Record<Exclude<ReportCellKind, 'text'>, string> = {
  money: '"$"#,##0.00',
  percent: '0.0%',
  integer: '#,##0',
  decimal: '#,##0.00',
};

/** Valor de celda: número real (centavos -> dólares) o texto neutralizado; «—» si no hay dato. */
export function excelValue(value: ReportCell, kind: ReportCellKind): string | number {
  if (value === null) return EMPTY_VALUE;
  if (typeof value === 'string') return value === '' ? '' : neutralizeFormula(value);
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  // Centavos enteros / 100: el doble más cercano al valor con dos decimales exactos.
  return kind === 'money' ? Math.round(value) / 100 : value;
}

function setCell(cell: ExcelJS.Cell, value: ReportCell, kind: ReportCellKind): void {
  const output = excelValue(value, kind);
  cell.value = output;
  if (typeof output === 'number' && kind !== 'text') {
    cell.numFmt = EXCEL_FORMATS[kind];
    cell.alignment = { horizontal: 'right', vertical: 'top' };
  } else {
    cell.alignment = {
      horizontal: typeof output === 'string' && output === EMPTY_VALUE ? 'right' : 'left',
      vertical: 'top',
      wrapText: true,
    };
  }
}

function addSheet(workbook: ExcelJS.Workbook, report: ReportDocument, table: ReportTable): void {
  const { meta } = report;
  const used = new Set(workbook.worksheets.map((sheet) => sheet.name));
  const sheet = workbook.addWorksheet(safeSheetName(table.sheetName || table.title, used));
  const lastColumn = table.columns.length;
  const generated = DateTime.fromISO(meta.generatedAt, { zone: meta.timezone });

  const line = (label: string, value: string, bold = false): ExcelJS.Row => {
    const row = sheet.addRow([neutralizeFormula(label), neutralizeFormula(value)]);
    row.getCell(1).font = { bold: true, color: { argb: MUTED } };
    row.getCell(2).font = { bold };
    return row;
  };

  const title = sheet.addRow([neutralizeFormula(`${meta.school} — ${table.title}`)]);
  title.font = { bold: true, size: 14, color: { argb: RED } };
  line(
    'Generado',
    `${generated.toFormat('dd/MM/yyyy HH:mm')} (hora de Ecuador) por ${meta.generatedBy.name} (${meta.generatedBy.role})`,
  );
  // Filtros aplicados, en las filas superiores de cada hoja.
  for (const filter of meta.filterSummary) line(filter.label, filter.value);
  if (meta.demoMode) {
    const demo = sheet.addRow([DEMO_REPORT_LABEL, 'Los pagos simulados no son ingresos reales']);
    demo.font = { bold: true, color: { argb: RED } };
  }
  for (const item of meta.omitted) line('No incluido', item.reason);
  sheet.addRow([neutralizeFormula(table.description)]).font = {
    italic: true,
    color: { argb: MUTED },
  };
  sheet.addRow([]);

  if (table.rows.length && table.indicators.length) {
    sheet.addRow(['Indicadores']).font = { bold: true };
    for (const indicator of table.indicators) {
      const row = sheet.addRow([neutralizeFormula(indicator.label)]);
      setCell(row.getCell(2), indicator.value, indicator.kind);
      row.getCell(2).font = { bold: true };
    }
    sheet.addRow([]);
  }

  const header = sheet.addRow(table.columns.map((column) => neutralizeFormula(column.label)));
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: RED } } };
  });
  header.height = 30;
  const headerRow = header.number;

  if (table.rows.length === 0) {
    const empty = sheet.addRow([EMPTY_REPORT_MESSAGE]);
    empty.font = { italic: true, color: { argb: MUTED } };
  } else {
    for (const data of table.rows) {
      const row = sheet.addRow([]);
      table.columns.forEach((column, index) => {
        setCell(row.getCell(index + 1), data[column.key] ?? null, column.kind);
      });
    }
    if (table.totals) {
      const totals = table.totals;
      const row = sheet.addRow([]);
      table.columns.forEach((column, index) => {
        const cell = row.getCell(index + 1);
        const value = totals[column.key] ?? null;
        // Una casilla de total sin valor queda vacía en lugar de «—».
        if (value === null) cell.value = '';
        else setCell(cell, value, column.kind);
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT_RED } };
        cell.border = { top: { style: 'thin' } };
      });
    }
    // Autofiltro sobre los datos (sin la fila de totales).
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow + table.rows.length, column: lastColumn },
    };
  }

  if (table.notes.length) {
    sheet.addRow([]);
    sheet.addRow(['Notas']).font = { bold: true, color: { argb: MUTED } };
    for (const note of table.notes)
      sheet.addRow([neutralizeFormula(note)]).font = { color: { argb: MUTED } };
  }
  sheet.addRow([]);
  sheet.addRow([CONFIDENTIALITY_LEGEND]).font = { italic: true, size: 9, color: { argb: MUTED } };

  // Panel congelado: los encabezados de la tabla quedan visibles al desplazarse.
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRow }];
  table.columns.forEach((column, index) => {
    const longest = Math.max(
      column.label.length,
      ...table.rows.map((row) => {
        const value = row[column.key];
        return typeof value === 'string' ? value.length : 12;
      }),
    );
    const min = index === 0 ? 26 : column.kind === 'text' ? 16 : 14;
    sheet.getColumn(index + 1).width = Math.min(48, Math.max(min, longest + 2));
  });
  if (lastColumn < 2) sheet.getColumn(2).width = 40;
}

export async function renderReportExcel(report: ReportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ColoradosDrive';
  workbook.created = new Date(report.meta.generatedAt);
  for (const table of report.reports) addSheet(workbook, report, table);
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}
