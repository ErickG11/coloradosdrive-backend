import { DateTime } from 'luxon';

import { AppError } from './AppError';
import { SCHOOL_TIMEZONE } from './schoolTimezone';

// Reglas de datos de una cohorte compartidas por el validador de rutas y el
// servicio (los CHECK de la migración 029 repiten los rangos como red de
// seguridad). Los mensajes son el contrato visible para el usuario.

export const COHORT_LIMITS = {
  nombreMax: 100,
  precioMax: 9999.99,
  cupoMin: 1,
  cupoMax: 500,
  recursosMax: 100,
  tipoModalidadMax: 100,
  horariosTeoriaMax: 500,
  aniosFuturoMax: 5,
} as const;

export const COHORT_MESSAGES = {
  idInvalido: 'La cohorte indicada no es válida.',
  cursoInvalido: 'Selecciona un curso válido.',
  cursoNoExiste: 'El curso indicado no existe.',
  cohorteNoExiste: 'Cohorte no encontrada.',
  nombreObligatorio: 'El nombre es obligatorio.',
  nombreLargo: 'El nombre no puede superar 100 caracteres.',
  nombreDuplicado: 'Ya existe una cohorte con ese nombre en este curso.',
  precioObligatorio: 'El precio es obligatorio.',
  precioRango: 'El precio debe estar entre 0 y 9999.99.',
  precioDecimales: 'El precio admite como máximo 2 decimales.',
  cupo: 'El cupo máximo debe ser un entero entre 1 y 500.',
  vehiculos: 'El número de vehículos debe ser un entero entre 0 y 100.',
  aulas: 'El número de aulas debe ser un entero entre 0 y 100.',
  tipoModalidad: 'La modalidad debe ser un texto de hasta 100 caracteres.',
  horariosTeoria:
    'Los horarios de capacitación teórica deben ser un texto de hasta 500 caracteres.',
  fechaInicioMatricula: 'La fecha de inicio de matrícula no es válida.',
  fechaFinMatricula: 'La fecha de fin de matrícula no es válida.',
  fechaInicioCurso: 'La fecha de inicio de curso no es válida.',
  fechaFinCurso: 'La fecha de fin de curso no es válida.',
  fechaLejana: 'La fecha no puede superar 5 años a partir de hoy.',
  finMatriculaAntesInicio: 'El fin de matrícula no puede ser anterior al inicio de matrícula.',
  finCursoAntesInicio: 'El fin de curso no puede ser anterior al inicio de curso.',
  cursoAntesMatricula: 'El curso no puede terminar antes de que abra la matrícula.',
} as const;

export const COHORT_DATE_FIELDS = [
  'fechaInicioMatricula',
  'fechaFinMatricula',
  'fechaInicioCurso',
  'fechaFinCurso',
] as const;
export type CohortDateField = (typeof COHORT_DATE_FIELDS)[number];
export type CohortDates = Record<CohortDateField, string>;

// El año 0000 no existe en PostgreSQL (daría 500 al guardar).
const FECHA_REGEX = /^(?!0000)\d{4}-\d{2}-\d{2}$/;

// Fecha civil «YYYY-MM-DD» que existe en el calendario (rechaza 2026-02-30).
export function isFechaCivil(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    FECHA_REGEX.test(value) &&
    DateTime.fromISO(value, { zone: SCHOOL_TIMEZONE }).isValid
  );
}

// Última fecha admitida: hoy (zona de la escuela) + 5 años, como «YYYY-MM-DD».
// Solo se acota hacia adelante: las fechas pasadas siguen siendo válidas.
export function maxCohortDate(now: DateTime = DateTime.now()): string {
  return now
    .setZone(SCHOOL_TIMEZONE)
    .startOf('day')
    .plus({ years: COHORT_LIMITS.aniosFuturoMax })
    .toFormat('yyyy-MM-dd');
}

function invalid(message: string, field: string): AppError {
  return new AppError(message, 400, { code: 'INVALID_FIELD', field });
}

/**
 * Reglas cruzadas de fechas sobre la cohorte resultante (en PATCH parcial,
 * los valores enviados combinados con los guardados). Las cadenas
 * «YYYY-MM-DD» se comparan bien como texto.
 */
export function assertCohortDates(dates: CohortDates): void {
  if (dates.fechaFinMatricula < dates.fechaInicioMatricula) {
    throw invalid(COHORT_MESSAGES.finMatriculaAntesInicio, 'fechaFinMatricula');
  }
  if (dates.fechaFinCurso < dates.fechaInicioCurso) {
    throw invalid(COHORT_MESSAGES.finCursoAntesInicio, 'fechaFinCurso');
  }
  if (dates.fechaFinCurso < dates.fechaInicioMatricula) {
    throw invalid(COHORT_MESSAGES.cursoAntesMatricula, 'fechaFinCurso');
  }
}

// Comparación de nombres equivalente al índice único de la migración 029:
// lower(btrim(nombre)).
export function normalizeCohortName(nombre: string): string {
  return nombre.trim().toLowerCase();
}
