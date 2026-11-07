import { supabaseAdmin } from '../config/supabase';
import { EnrollmentLimitsService } from '../services/enrollmentLimits.service';
import { asyncHandler } from '../utils/asyncHandler';

const service = new EnrollmentLimitsService(supabaseAdmin);
export const reserveEnrollmentCodeIp = asyncHandler(async (req, _res, next) => {
  await service.reserveCodeIp(req.ip);
  next();
});
export const reserveEnrollmentCode = asyncHandler(async (req, _res, next) => {
  await service.reserveCode((req.body as { correo: string }).correo);
  next();
});
// Antes de Multer: cada intento de subida cuenta para los topes aunque el archivo sea inválido.
export const reserveEnrollmentUpload = asyncHandler(async (req, _res, next) => {
  await service.reserveUpload(req.ip, req.params.id);
  next();
});
