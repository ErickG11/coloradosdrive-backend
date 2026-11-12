import { isValidCedulaEcuatoriana } from './cedula';
import { cohortError } from '../config/cohortErrors';
export type IdentityDocumentType = 'cedula' | 'pasaporte' | 'otro';
export interface IdentityDocument {
  type: IdentityDocumentType;
  number: string;
}
export function normalizeIdentityDocument(type: unknown, number: unknown): IdentityDocument {
  if (type !== 'cedula' && type !== 'pasaporte' && type !== 'otro')
    throw cohortError('DOCUMENTO_TIPO_INVALIDO');
  if (typeof number !== 'string') throw cohortError('DOCUMENTO_NUMERO_INVALIDO');
  const normalized = number.trim().toUpperCase();
  if (
    type === 'cedula'
      ? !isValidCedulaEcuatoriana(normalized)
      : !/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(normalized)
  )
    throw cohortError('DOCUMENTO_NUMERO_INVALIDO');
  return { type, number: normalized };
}
