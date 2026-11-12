import { AppError } from '../utils/AppError';

export const COHORT_ERRORS = {
  PLAN_CONFIG_NO_DISPONIBLE: {status:503,cause:'No se pudo leer la configuración del plan',student:'No se pudo consultar el plan. Intenta nuevamente.',admin:'La configuración de reglas no está disponible.',action:'Verificar la configuración y reintentar.'},
  PLAN_ENTRADA_INVALIDA: { status: 400, cause: 'Formato, modalidad u horas fuera de rango', student: 'Revisa la fecha, modalidad y horas de tu plan.', admin: 'El plan debe tener 15 horas, de 1 a 6 por día y franjas de 06:00 a 22:00.', action: 'Corregir los campos indicados y volver a consultar.' },
  PLAN_INICIO_PASADO: { status: 409, cause: 'Primera fecha anterior al día de Guayaquil', student: 'Elige una fecha de inicio desde hoy.', admin: 'El inicio efectivo del plan está en el pasado.', action: 'Seleccionar una fecha vigente.' },
  PLAN_FRANJA_PASADA: { status: 409, cause: 'Alguna franja ya comenzó', student: 'Esa hora ya pasó. Elige una hora posterior.', admin: 'Todas las franjas deben ser posteriores al instante del servidor.', action: 'Recargar disponibilidad y elegir otra hora.' },
  COHORTE_FECHAS_INVALIDAS: { status: 422, cause: 'Cadena de fechas inválida', student: 'No se puede utilizar ese período de inscripción.', admin: 'Debe cumplirse inicio de matrícula ≤ fin de matrícula ≤ fin del curso e inicio del curso ≤ fin del curso.', action: 'Ajustar las fechas relacionadas en una sola operación.' },
} as const;
export type CohortErrorCode = keyof typeof COHORT_ERRORS;
export function cohortError(code: CohortErrorCode): AppError {
  return new AppError(COHORT_ERRORS[code].student, COHORT_ERRORS[code].status, { code });
}
