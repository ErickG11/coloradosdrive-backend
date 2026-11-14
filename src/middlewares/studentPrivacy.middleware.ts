import { COHORT_ERRORS } from '../config/cohortErrors';
import type { RequestHandler, Response } from 'express';
const cohortContainers = new Set(['cohort', 'cohorte', 'cohorts', 'cohortes', 'cohortsummary']);
const flattened = new Set([
  'cohortname',
  'cohortcode',
  'cohortenombre',
  'cohortecodigo',
  'nombrecohorte',
  'codigocohorte',
  'cohortlabel',
]);
const normalized = (key: string): string => key.replace(/[_\s-]/g, '').toLowerCase();
/** Frontera única de salida para todos los routers autenticados de alumno, incluidas ramas legacy. */
export function studentResponse(value: unknown, cohort = false): unknown {
  if (Array.isArray(value)) return value.map((item) => studentResponse(item, cohort));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const name = normalized(key);
    if (
      (cohortContainers.has(name) && typeof item === 'string') ||
      flattened.has(name) ||
      (cohort && ['nombre', 'name', 'codigo', 'code', 'label'].includes(name)) ||
      name === 'stack'
    )
      continue;
    result[key] = studentResponse(item, cohort || cohortContainers.has(name));
  }
  return result;
}
export const studentPrivacy: RequestHandler = (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body: unknown): Response => {
    const student =
      req.user?.role === 'estudiante' ||
      /^\/(?:solicitudes|public\/inscripcion)(?:\/|$)/.test(req.originalUrl);
    if (!student) return json(body);
    const safe = studentResponse(body, /^\/cohorts(?:\/|$)/.test(req.originalUrl));
    if (
      safe &&
      typeof safe === 'object' &&
      'code' in safe &&
      typeof safe.code === 'string' &&
      safe.code in COHORT_ERRORS &&
      safe.code !== 'RESERVA_SOLAPE_PROPIO'
    ) {
      return json({
        ...safe,
        message: COHORT_ERRORS[safe.code as keyof typeof COHORT_ERRORS].student,
      });
    }
    return json(safe);
  };
  next();
};
