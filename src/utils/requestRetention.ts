import { RETENCION_INSCRIPCION } from '../config/enrollmentCatalog';
import type { RequestRetentionPolicy } from '../models/requestReview.model';
/** null hereda el ajuste vigente del backend; no sustituye un plazo operativo existente. */
export interface ResolvedRequestRetention extends Omit<RequestRetentionPolicy, 'rechazadaDias'> {
  rechazadaDias: number;
}
export function resolveRequestRetention(
  policy: RequestRetentionPolicy | null,
  rejectedDays: number,
): ResolvedRequestRetention {
  return {
    ...RETENCION_INSCRIPCION,
    ...policy,
    rechazadaDias: policy?.rechazadaDias ?? rejectedDays,
    aprobadaDias: null,
    archivadaDias: null,
  };
}
