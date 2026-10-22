import { AppError } from './AppError';

// Traducción central y opcional de errores de PostgreSQL (vía PostgREST) a
// respuestas 4xx en español. Cada servicio decide si la usa y puede afinar
// el mensaje por nombre de restricción; los servicios que ya tienen su
// propio mapeo no cambian.

export interface PostgresErrorOverride {
  status: number;
  message: string;
  code: string;
  field?: string;
}

const DEFAULTS: Record<string, PostgresErrorOverride> = {
  '22003': {
    status: 400,
    message: 'Un valor numérico está fuera del rango permitido.',
    code: 'VALUE_OUT_OF_RANGE',
  },
  '23505': {
    status: 409,
    message: 'Ya existe un registro con esos datos.',
    code: 'DUPLICATE',
  },
  '23514': {
    status: 400,
    message: 'Los datos no cumplen las reglas de validación.',
    code: 'CHECK_VIOLATION',
  },
  '23503': {
    status: 409,
    message: 'El registro está relacionado con otros datos y no se puede completar la operación.',
    code: 'FOREIGN_KEY_VIOLATION',
  },
};

// PostgREST no expone el nombre de la restricción como campo propio: viene
// dentro del mensaje («... violates check constraint "nombre"»).
export function postgresConstraintName(error: unknown): string | undefined {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') return undefined;
  return /constraint "([^"]+)"/.exec(message)?.[1];
}

/**
 * Devuelve un AppError 4xx si `error` es un error de PostgreSQL conocido
 * (22003, 23505, 23514, 23503); si no, null para que el llamador lo relance
 * tal cual (sigue siendo 500). `byConstraint` permite un mensaje y campo
 * concretos por restricción.
 */
export function mapPostgresError(
  error: unknown,
  byConstraint: Record<string, PostgresErrorOverride> = {},
): AppError | null {
  if (error instanceof AppError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !Object.hasOwn(DEFAULTS, code)) return null;
  const constraint = postgresConstraintName(error);
  const entry =
    constraint !== undefined && Object.hasOwn(byConstraint, constraint)
      ? byConstraint[constraint]
      : DEFAULTS[code];
  return new AppError(entry.message, entry.status, {
    code: entry.code,
    ...(entry.field ? { field: entry.field } : {}),
  });
}
