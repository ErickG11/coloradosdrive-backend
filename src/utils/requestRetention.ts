import { RETENCION_INSCRIPCION } from '../config/enrollmentCatalog';
import type { RequestRetentionPolicy } from '../models/requestReview.model';
/** null hereda el ajuste vigente del backend; no sustituye un plazo operativo existente. */
export function resolveRequestRetention(
  policy: RequestRetentionPolicy | null,
  rejectedDays: number,
) {
  return {
    ...RETENCION_INSCRIPCION,
    ...policy,
    rechazadaDias: policy?.rechazadaDias ?? rejectedDays,
    aprobadaDias: null,
    archivadaDias: null,
  };
}
