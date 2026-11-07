import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { CaptchaService } from '../services/captcha.service';
import { asyncHandler } from '../utils/asyncHandler';

export function captchaMiddleware(service: Pick<CaptchaService, 'verify'>): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const body = req.body as { captchaToken?: unknown } | undefined;
    await service.verify(body?.captchaToken, req.ip);
    next();
  });
}
export const verifyEnrollmentCaptcha = captchaMiddleware(new CaptchaService(env));
