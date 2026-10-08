import { AppError } from './AppError';

export const DOCUMENT_TYPES = [
  'cedula', 'papeleta_votacion', 'tipo_sangre', 'titulo_bachiller',
] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];
export type DocumentStatus = 'entregado' | 'pendiente' | 'no_aplica';
export interface DocumentInput { tipo: DocumentType; estado: DocumentStatus }
export interface InitialPayment {
  modalidad: 'abono' | 'completo';
  descuento: number;
  montoAbonado: number;
}

export function validateDocumentUpdates(documents: DocumentInput[]): DocumentInput[] {
  if (!Array.isArray(documents) || documents.length > DOCUMENT_TYPES.length ||
      documents.some((candidate: unknown) => {
        if (candidate === null || typeof candidate !== 'object') return true;
        const document = candidate as Record<string, unknown>;
        return !DOCUMENT_TYPES.includes(document.tipo as DocumentType) ||
          !['entregado', 'pendiente', 'no_aplica'].includes(document.estado as string);
      }) ||
      new Set(documents.map((document) => document.tipo)).size !== documents.length)
    throw new AppError('El checklist contiene documentos o estados inválidos o repetidos', 400);
  return documents;
}

export function normalizeDocuments(documents: DocumentInput[] = []): DocumentInput[] {
  validateDocumentUpdates(documents);
  return DOCUMENT_TYPES.map((tipo) =>
    documents.find((document) => document.tipo === tipo) ?? { tipo, estado: 'pendiente' });
}

export function applyVotingExemption(documents: DocumentInput[], birthDate: string | null,
  today: string): DocumentInput[] {
  if (!birthDate) return documents;
  const age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4)) -
    (today.slice(5) < birthDate.slice(5) ? 1 : 0);
  if (age < 65) return documents;
  return documents.map((document) => document.tipo === 'papeleta_votacion'
    ? { ...document, estado: 'no_aplica' } : document);
}

function validMoney(value: number): boolean {
  return Number.isFinite(value) && value >= 0 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

export function validateInitialPayment(price: number | null, payment: InitialPayment): number | null {
  if (!['abono', 'completo'].includes(payment.modalidad) ||
      !validMoney(payment.descuento) || !validMoney(payment.montoAbonado))
    throw new AppError('El pago inicial debe indicar modalidad y montos válidos con hasta dos decimales', 400);
  if (price === null) {
    if (payment.descuento !== 0 || payment.modalidad !== 'abono')
      throw new AppError('Sin cohorte solo se permite un abono y descuento cero', 400);
    return null;
  }
  if (payment.descuento > price)
    throw new AppError('El descuento no puede superar el precio de la cohorte', 400);
  const net = Math.round((price - payment.descuento) * 100) / 100;
  if (payment.montoAbonado > net)
    throw new AppError('El abono no puede superar el monto total neto', 400);
  if (payment.modalidad === 'completo' && payment.montoAbonado !== net)
    throw new AppError('El pago completo debe igualar el monto total neto', 400);
  if (payment.modalidad === 'abono' && payment.montoAbonado === net && net > 0)
    throw new AppError('Un pago del monto total debe indicarse como completo', 400);
  return net;
}
