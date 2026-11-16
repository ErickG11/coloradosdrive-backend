import { DateTime } from 'luxon';
import PDFDocument from 'pdfkit';

import {
  CONFIDENTIALITY_LEGEND,
  DEMO_REPORT_LABEL,
  EMPTY_REPORT_MESSAGE,
  type ReportCell,
  type ReportCellKind,
  type ReportChart,
  type ReportColumn,
  type ReportDocument,
  type ReportTable,
} from '../models/report.model';
import { formatCell } from '../utils/reportFormat';

// RF-08 · PDF con PDFKit, sin navegador headless. Fuentes estándar del PDF
// (Helvetica, codificación WinAnsi): cubren tildes, eñes y signos del español
// sin incrustar archivos de fuente. Encabezado y pie se dibujan al final sobre
// las páginas en búfer para poder numerar «Página X de Y».

const RED = '#b42323';
const INK = '#18202b';
const MUTED = '#566171';
const LINE = '#d5dae2';
const ZEBRA = '#f6f7f9';
const SOFT_RED = '#fbecec';
const MARGIN = 40;
const HEADER_HEIGHT = 46;
const CONTENT_TOP = MARGIN + HEADER_HEIGHT + 14;
const FOOTER_HEIGHT = 30;
const CELL_PAD = 4;
const TABLE_FONT = 8;
const MAX_CELL_LINES = 3;
const MAX_CHART_BARS = 8;

/** Texto seguro para WinAnsi: sin saltos ni caracteres que la fuente no puede dibujar. */
export function pdfSafeText(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F\u00A0]+/g, ' ')
      .replace(/[^ -~¡-ÿ–—‘’“”•…€]/g, '?')
  );
}

const isNumeric = (kind: ReportCellKind): boolean => kind !== 'text';

class PdfReportWriter {
  private readonly doc: PDFKit.PDFDocument;
  private y = CONTENT_TOP;

  constructor(private readonly report: ReportDocument) {
    this.doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: pdfSafeText(`${report.meta.title} - ColoradosDrive`),
        Author: 'ColoradosDrive',
        Subject: 'Reporte administrativo',
      },
    });
  }

  private get width(): number {
    return this.doc.page.width - MARGIN * 2;
  }

  private get bottom(): number {
    return this.doc.page.height - MARGIN - FOOTER_HEIGHT;
  }

  private newPage(): void {
    this.doc.addPage();
    this.y = CONTENT_TOP;
  }

  private ensure(height: number): boolean {
    if (this.y + height <= this.bottom) return false;
    this.newPage();
    return true;
  }

  private text(
    value: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: string;
      width?: number;
      x?: number;
      gap?: number;
    } = {},
  ): void {
    const {
      size = 9,
      bold = false,
      color = INK,
      width = this.width,
      x = MARGIN,
      gap = 4,
    } = options;
    const content = pdfSafeText(value);
    this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const height = this.doc.heightOfString(content, { width });
    this.ensure(height);
    this.doc.fillColor(color).text(content, x, this.y, { width });
    this.y += height + gap;
  }

  render(): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      this.doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      this.doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      this.doc.on('error', reject);
      try {
        this.cover();
        this.report.reports.forEach((table, index) => {
          if (index > 0) this.newPage();
          this.section(table);
        });
        this.decorate();
        this.doc.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('No se pudo generar el PDF'));
      }
    });
  }

  private cover(): void {
    const { meta } = this.report;
    const generated = DateTime.fromISO(meta.generatedAt, { zone: meta.timezone });
    this.text(meta.title, { size: 17, bold: true, gap: 6 });
    this.text(
      `Generado el ${generated.toFormat('dd/MM/yyyy')} a las ${generated.toFormat('HH:mm')} (hora de Ecuador) por ${meta.generatedBy.name} (${meta.generatedBy.role})`,
      { color: MUTED, gap: 10 },
    );
    if (meta.demoMode) {
      this.doc.font('Helvetica-Bold').fontSize(9);
      const label = pdfSafeText(
        `${DEMO_REPORT_LABEL.toUpperCase()}: los pagos simulados no son ingresos reales`,
      );
      const boxWidth = this.doc.widthOfString(label) + 16;
      this.doc.roundedRect(MARGIN, this.y, boxWidth, 18, 3).fill(SOFT_RED);
      this.doc.fillColor(RED).text(label, MARGIN + 8, this.y + 5, { lineBreak: false });
      this.y += 28;
    }
    this.text('Filtros aplicados', { size: 10, bold: true, color: RED, gap: 4 });
    for (const filter of meta.filterSummary)
      this.text(`${filter.label}: ${filter.value}`, { gap: 2 });
    for (const item of meta.omitted)
      this.text(`No incluido — ${item.reason}`, { color: MUTED, gap: 2 });
    this.y += 10;
    this.doc
      .moveTo(MARGIN, this.y)
      .lineTo(MARGIN + this.width, this.y)
      .lineWidth(0.6)
      .strokeColor(LINE)
      .stroke();
    this.y += 14;
  }

  private section(table: ReportTable): void {
    this.ensure(60);
    this.text(table.title, { size: 13, bold: true, color: RED, gap: 3 });
    this.text(table.description, { color: MUTED, gap: 10 });
    if (table.rows.length === 0) {
      this.ensure(44);
      this.doc.roundedRect(MARGIN, this.y, this.width, 36, 4).fill(ZEBRA);
      this.doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(MUTED)
        .text(pdfSafeText(EMPTY_REPORT_MESSAGE), MARGIN, this.y + 13, {
          width: this.width,
          align: 'center',
        });
      this.y += 48;
    } else {
      this.indicators(table);
      this.table(table);
      if (table.chart) this.chart(table.chart);
    }
    if (table.notes.length) {
      this.y += 4;
      this.text('Notas', { size: 8.5, bold: true, color: MUTED, gap: 2 });
      for (const note of table.notes) this.text(`• ${note}`, { size: 8, color: MUTED, gap: 2 });
    }
  }

  private indicators(table: ReportTable): void {
    const items = table.indicators;
    if (!items.length) return;
    const gap = 10;
    const cardWidth = (this.width - gap * (items.length - 1)) / items.length;
    this.ensure(52);
    items.forEach((indicator, index) => {
      const x = MARGIN + index * (cardWidth + gap);
      this.doc.roundedRect(x, this.y, cardWidth, 42, 4).lineWidth(0.6).strokeColor(LINE).stroke();
      this.doc.rect(x, this.y + 6, 2.5, 30).fill(RED);
      this.doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(pdfSafeText(indicator.label), x + 10, this.y + 7, {
          width: cardWidth - 16,
          height: 10,
          ellipsis: true,
          lineBreak: false,
        });
      this.doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .fillColor(INK)
        .text(pdfSafeText(formatCell(indicator.value, indicator.kind)), x + 10, this.y + 20, {
          width: cardWidth - 16,
          height: 16,
          ellipsis: true,
          lineBreak: false,
        });
    });
    this.y += 54;
  }

  /**
   * Anchos por contenido: cada columna recibe al menos lo que necesita la palabra
   * más larga de su encabezado y sus cifras; el espacio sobrante se reparte entre
   * las columnas de texto. Si no cabe todo, se reduce en proporción.
   */
  private columnWidths(table: ReportTable): number[] {
    const { columns } = table;
    const measure = (text: string, bold: boolean): number => {
      this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(TABLE_FONT);
      return this.doc.widthOfString(pdfSafeText(text));
    };
    const rows = table.totals ? [...table.rows, table.totals] : table.rows;
    const minimum = columns.map((column) => {
      const headerWord = Math.max(...column.label.split(/\s+/).map((word) => measure(word, true)));
      const cells = rows.map((row) => {
        const value = row[column.key] ?? null;
        return measure(value === null || value === '' ? '' : formatCell(value, column.kind), true);
      });
      const widest = Math.max(0, ...cells);
      const content = column.kind === 'text' ? Math.min(widest, 150) : widest;
      return Math.max(headerWord, content) + CELL_PAD * 2 + 6;
    });
    const used = minimum.reduce((acc, value) => acc + value, 0);
    if (used >= this.width) return minimum.map((value) => (value / used) * this.width);
    const flexible = columns.map((column) => column.kind === 'text');
    const share = flexible.some(Boolean) ? flexible : columns.map(() => true);
    const weight = share.reduce(
      (acc, isFlexible, index) => acc + (isFlexible ? minimum[index] : 0),
      0,
    );
    const extra = this.width - used;
    return minimum.map((value, index) => (share[index] ? value + (extra * value) / weight : value));
  }

  private rowHeight(cells: string[], widths: number[], bold: boolean): number {
    this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(TABLE_FONT);
    const lineHeight = this.doc.currentLineHeight(true);
    const tallest = Math.max(
      ...cells.map((cell, index) =>
        this.doc.heightOfString(cell, { width: widths[index] - CELL_PAD * 2 }),
      ),
    );
    return Math.min(tallest, lineHeight * MAX_CELL_LINES) + CELL_PAD * 2;
  }

  private drawRow(
    cells: string[],
    columns: ReportColumn[],
    widths: number[],
    style: { bold: boolean; color: string; fill?: string; height: number },
  ): void {
    if (style.fill) this.doc.rect(MARGIN, this.y, this.width, style.height).fill(style.fill);
    this.doc.font(style.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(TABLE_FONT);
    let x = MARGIN;
    cells.forEach((cell, index) => {
      // Texto largo: se ajusta al ancho y se recorta con puntos suspensivos; nunca desborda.
      this.doc.fillColor(style.color).text(cell, x + CELL_PAD, this.y + CELL_PAD, {
        width: widths[index] - CELL_PAD * 2,
        height: style.height - CELL_PAD * 2 + 1,
        ellipsis: true,
        align: isNumeric(columns[index].kind) ? 'right' : 'left',
      });
      x += widths[index];
    });
    this.y += style.height;
  }

  private tableHeader(columns: ReportColumn[], widths: number[]): void {
    const labels = columns.map((column) => pdfSafeText(column.label));
    const height = this.rowHeight(labels, widths, true);
    this.drawRow(labels, columns, widths, { bold: true, color: '#ffffff', fill: RED, height });
  }

  private table(table: ReportTable): void {
    const widths = this.columnWidths(table);
    // En la fila de totales una casilla sin valor queda en blanco, no con «—».
    const cellsOf = (row: Record<string, ReportCell>, blankNull = false): string[] =>
      table.columns.map((column) => {
        const value = row[column.key] ?? null;
        if (value === '' || (blankNull && value === null)) return '';
        return pdfSafeText(formatCell(value, column.kind));
      });
    this.ensure(60);
    this.tableHeader(table.columns, widths);
    table.rows.forEach((row, index) => {
      const cells = cellsOf(row);
      const height = this.rowHeight(cells, widths, false);
      // El encabezado se repite en cada página de la tabla.
      if (this.ensure(height)) this.tableHeader(table.columns, widths);
      this.drawRow(cells, table.columns, widths, {
        bold: false,
        color: INK,
        fill: index % 2 === 1 ? ZEBRA : undefined,
        height,
      });
    });
    if (table.totals) {
      const cells = cellsOf(table.totals, true);
      const height = this.rowHeight(cells, widths, true);
      if (this.ensure(height + 2)) this.tableHeader(table.columns, widths);
      this.doc
        .moveTo(MARGIN, this.y)
        .lineTo(MARGIN + this.width, this.y)
        .lineWidth(0.8)
        .strokeColor(INK)
        .stroke();
      this.drawRow(cells, table.columns, widths, {
        bold: true,
        color: INK,
        fill: SOFT_RED,
        height,
      });
    }
    this.y += 14;
  }

  private chart(chart: ReportChart): void {
    const items = [...chart.items]
      .filter((item) => Number.isFinite(item.value) && item.value >= 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_CHART_BARS);
    const max = Math.max(...items.map((item) => item.value), 0);
    if (!items.length || max <= 0) return;
    const rowHeight = 15;
    this.ensure(22 + items.length * rowHeight);
    this.text(chart.title, { size: 9, bold: true, gap: 6 });
    const labelWidth = 190;
    const valueWidth = 80;
    const barMax = this.width - labelWidth - valueWidth - 16;
    for (const item of items) {
      this.doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(INK)
        .text(pdfSafeText(item.label), MARGIN, this.y + 3, {
          width: labelWidth,
          height: 10,
          ellipsis: true,
          lineBreak: false,
        });
      const barWidth = Math.max(1.5, (item.value / max) * barMax);
      this.doc.roundedRect(MARGIN + labelWidth + 8, this.y + 2, barWidth, 9, 2).fill(RED);
      this.doc
        .fillColor(MUTED)
        .text(
          pdfSafeText(formatCell(item.value, chart.kind)),
          MARGIN + labelWidth + 16 + barMax,
          this.y + 3,
          { width: valueWidth, align: 'right', lineBreak: false },
        );
      this.y += rowHeight;
    }
    if (chart.items.length > items.length)
      this.text(`Se muestran los ${String(items.length)} valores más altos.`, {
        size: 7.5,
        color: MUTED,
      });
    this.y += 6;
  }

  /** Encabezado y pie en todas las páginas, con numeración «Página X de Y». */
  private decorate(): void {
    const { meta } = this.report;
    const range = this.doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      this.doc.switchToPage(range.start + index);
      // Sin margen inferior temporalmente: escribir el pie no debe crear páginas nuevas.
      const margins = this.doc.page.margins;
      this.doc.page.margins = { ...margins, bottom: 0 };
      const pageWidth = this.doc.page.width;
      this.doc.rect(0, 0, pageWidth, 6).fill(RED);
      this.doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(INK)
        .text(pdfSafeText(meta.school), MARGIN, MARGIN - 14, {
          width: this.width / 2,
          lineBreak: false,
        });
      this.doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(MUTED)
        .text(pdfSafeText(meta.title), MARGIN + this.width / 2, MARGIN - 13, {
          width: this.width / 2,
          align: 'right',
          lineBreak: false,
        });
      if (meta.demoMode)
        this.doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .fillColor(RED)
          .text(pdfSafeText(DEMO_REPORT_LABEL), MARGIN, MARGIN + 2, {
            width: this.width,
            lineBreak: false,
          });
      this.doc
        .moveTo(MARGIN, MARGIN + HEADER_HEIGHT - 28)
        .lineTo(MARGIN + this.width, MARGIN + HEADER_HEIGHT - 28)
        .lineWidth(0.6)
        .strokeColor(LINE)
        .stroke();
      const footerY = this.doc.page.height - MARGIN - 12;
      this.doc
        .moveTo(MARGIN, footerY - 8)
        .lineTo(MARGIN + this.width, footerY - 8)
        .lineWidth(0.6)
        .strokeColor(LINE)
        .stroke();
      this.doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(MUTED)
        .text(pdfSafeText(CONFIDENTIALITY_LEGEND), MARGIN, footerY, {
          width: this.width - 90,
          height: 18,
          ellipsis: true,
        });
      this.doc.text(
        `Página ${String(index + 1)} de ${String(range.count)}`,
        MARGIN + this.width - 90,
        footerY,
        {
          width: 90,
          align: 'right',
          lineBreak: false,
        },
      );
      this.doc.page.margins = margins;
    }
  }
}

export function renderReportPdf(report: ReportDocument): Promise<Buffer> {
  return new PdfReportWriter(report).render();
}
