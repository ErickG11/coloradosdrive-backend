import type {
  ReportCell,
  ReportCellKind,
  ReportFormat,
  ReportSelection,
} from '../models/report.model';

// Utilidades puras de presentación de reportes (RF-08). Sin dependencias de
// Intl para el dinero: el resultado no depende del ICU del servidor.

export const EMPTY_VALUE = '—';

/**
 * Convierte un importe decimal en dólares ("150", "150.5", "150.00") a centavos
 * enteros SIN pasar por punto flotante. Devuelve null si no es un importe válido.
 */
export function dollarsToCentavos(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const padded = `${fraction}000`;
  let centavos = Number(whole) * 100 + Number(padded.slice(0, 2));
  // Redondeo al centavo si la base guardara más de dos decimales.
  if (Number(padded[2]) >= 5) centavos += 1;
  if (!Number.isSafeInteger(centavos)) return null;
  return sign === '-' && centavos !== 0 ? -centavos : centavos;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 1234567 centavos -> "$12.345,67" (formato de Ecuador), con aritmética entera. */
export function formatCentavos(centavos: number): string {
  if (!Number.isFinite(centavos)) return EMPTY_VALUE;
  const rounded = Math.round(centavos);
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${rounded < 0 ? '-' : ''}$${groupThousands(String(whole))},${cents}`;
}

/** Proporción con denominador cero -> null; nunca NaN ni Infinity. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${(Math.round(value * 1000) / 10).toFixed(1).replace('.', ',')} %`;
}

export function formatDecimal(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return EMPTY_VALUE;
  const [whole, fraction] = value.toFixed(digits).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = groupThousands(whole.replace('-', ''));
  return fraction ? `${sign}${grouped},${fraction}` : `${sign}${grouped}`;
}

export function formatInteger(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EMPTY_VALUE;
  return formatDecimal(Math.round(value), 0);
}

/** Texto de una celda para el PDF (y cualquier salida no numérica). */
export function formatCell(value: ReportCell, kind: ReportCellKind): string {
  if (value === null || value === '') return EMPTY_VALUE;
  if (typeof value === 'string') return value;
  switch (kind) {
    case 'money':
      return formatCentavos(value);
    case 'percent':
      return formatPercent(value);
    case 'decimal':
      return formatDecimal(value);
    case 'integer':
      return formatInteger(value);
    default:
      return String(value);
  }
}

/**
 * Neutraliza la inyección de fórmulas (CSV/Excel injection): un texto que
 * empieza por = + - @, tabulador o retorno de carro se antepone con un
 * apóstrofo para que la hoja de cálculo lo trate como texto literal.
 * También elimina caracteres de control que corrompen el XML del .xlsx.
 */
export function neutralizeFormula(value: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return /^[=+\-@\t\r]/.test(clean) ? `'${clean}` : clean;
}

const SHEET_FORBIDDEN = /[\\/?*[\]:]/g;

/**
 * Nombre de hoja válido para Excel: sin \ / ? * [ ] :, sin apóstrofos en los
 * extremos, máximo 31 caracteres, nunca vacío y único dentro de `used`.
 */
export function safeSheetName(name: string, used: ReadonlySet<string> = new Set()): string {
  // eslint-disable-next-line no-control-regex
  let base = name.replace(SHEET_FORBIDDEN, ' ').replace(/[\u0000-\u001F]/g, ' ');
  base = base
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim();
  if (!base) base = 'Reporte';
  base = base.slice(0, 31).trim();
  const taken = new Set([...used].map((item) => item.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` (${String(index)})`;
    const candidate = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

const FILE_PART = /^[a-z0-9-]+$/;
const FILE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Nombre de archivo generado por el servidor: reporte-<tipo>-<desde>_<hasta>.<ext>.
 * Solo acepta valores ya validados (listas cerradas y fechas ISO); cualquier
 * otra cosa se sustituye, de modo que nunca viaja texto libre del usuario.
 */
export function reportFileName(
  tipo: ReportSelection,
  desde: string,
  hasta: string,
  formato: ReportFormat,
): string {
  const safeTipo = FILE_PART.test(tipo) ? tipo : 'reporte';
  const safeDesde = FILE_DATE.test(desde) ? desde : 'inicio';
  const safeHasta = FILE_DATE.test(hasta) ? hasta : 'fin';
  const ext = formato === 'pdf' ? 'pdf' : 'xlsx';
  return `reporte-${safeTipo}-${safeDesde}_${safeHasta}.${ext}`;
}
