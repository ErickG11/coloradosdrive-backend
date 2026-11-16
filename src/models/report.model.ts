// RF-08 · Estructura neutral de reportes (CD-346). La consumen por igual el
// endpoint JSON, el generador de PDF y el de Excel: una sola fuente de cifras.
// Convenciones de celda:
//  - money: centavos USD enteros (15000 = USD 150,00); nunca decimales flotantes.
//  - percent: proporción 0..1; null cuando el denominador es cero (se muestra «—»).
//  - integer / decimal: número; null = sin dato.
//  - text: cadena ya presentable en español.

export const REPORT_TYPES = [
  'matriculas',
  'asistencia',
  'examenes',
  'finanzas',
  'instructores',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportSelection = ReportType | 'todos';
export const REPORT_SELECTIONS: readonly ReportSelection[] = [...REPORT_TYPES, 'todos'];

export const REPORT_FORMATS = ['pdf', 'xlsx'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const COURSE_TYPE_FILTERS = ['A', 'B', 'todos'] as const;
export type CourseTypeFilter = (typeof COURSE_TYPE_FILTERS)[number];

export interface ReportFilters {
  /** Fecha civil ISO (YYYY-MM-DD) en America/Guayaquil, inclusiva. */
  desde: string;
  /** Fecha civil ISO (YYYY-MM-DD) en America/Guayaquil, inclusiva. */
  hasta: string;
  tipoCurso: CourseTypeFilter;
  cohorteId: string | null;
  tipo: ReportSelection;
}

export interface ReportActor {
  id: string;
  /** Solo lo cumple un administrador con permiso de pagos y facturas (o sin la regla activa). */
  canViewFinance: boolean;
}

export type ReportCellKind = 'text' | 'integer' | 'decimal' | 'money' | 'percent';
export type ReportCell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportCellKind;
}

export interface ReportIndicator {
  label: string;
  kind: ReportCellKind;
  value: ReportCell;
}

export interface ReportChart {
  title: string;
  kind: ReportCellKind;
  items: { label: string; value: number }[];
}

export interface ReportTable {
  type: ReportType;
  title: string;
  /** Nombre de hoja de Excel ya saneado (máx. 31 caracteres, sin caracteres prohibidos). */
  sheetName: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** Fila de totales; null cuando no hay filas. */
  totals: Record<string, ReportCell> | null;
  indicators: ReportIndicator[];
  notes: string[];
  chart: ReportChart | null;
  /** Filas contadas para auditoría y topes. */
  rowCount: number;
}

export interface ReportDocumentMeta {
  school: string;
  title: string;
  generatedAt: string;
  timezone: string;
  /** Nombre y rol de quien genera; nunca el correo. */
  generatedBy: { name: string; role: string };
  filters: ReportFilters;
  /** Filtros en texto legible, en el orden en que se muestran. */
  filterSummary: { label: string; value: string }[];
  demoMode: boolean;
  /** Reportes pedidos que se omitieron y por qué (p. ej. finanzas sin permiso). */
  omitted: { type: ReportType; reason: string }[];
}

export interface ReportDocument {
  meta: ReportDocumentMeta;
  reports: ReportTable[];
}

export const EMPTY_REPORT_MESSAGE = 'Sin datos para el período seleccionado';
export const DEMO_REPORT_LABEL = 'Datos de demostración';
export const CONFIDENTIALITY_LEGEND =
  'Documento confidencial de uso interno. Contiene información agregada de la escuela; no lo compartas fuera de la administración.';
