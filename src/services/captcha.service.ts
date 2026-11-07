import { type CaptchaConfig, validateCaptchaConfiguration } from '../config/captcha';
import { AppError } from '../utils/AppError';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const CAPTCHA_TIMEOUT_MS = 5000;
function unavailable(): AppError {
  return new AppError(
    'La verificación de seguridad no está disponible. Reintenta o contacta a la escuela por WhatsApp.',
    503,
    { code: 'VERIFICACION_NO_DISPONIBLE' },
  );
}
export class CaptchaService {
  constructor(
    private readonly config: CaptchaConfig & { FRONTEND_URL: string },
    private readonly request: typeof fetch = fetch,
  ) {
    validateCaptchaConfiguration(config);
  }
  async verify(token: unknown, remoteip: string | undefined): Promise<void> {
    if (this.config.CAPTCHA_PROVIDER === 'off') return;
    const invalid = (): AppError =>
      new AppError('Completa de nuevo la verificación de seguridad.', 400, {
        code: 'CAPTCHA_INVALIDO',
        field: 'captchaToken',
      });
    if (
      typeof token !== 'string' ||
      !token.trim() ||
      token.length > 2048 ||
      /[\p{Cc}\p{Cf}]/u.test(token)
    )
      throw invalid();
    let data: unknown;
    try {
      const response = await this.request(SITEVERIFY, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: this.config.TURNSTILE_SECRET_KEY,
          response: token,
          ...(remoteip ? { remoteip } : {}),
        }),
        signal: AbortSignal.timeout(CAPTCHA_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('siteverify_unavailable');
      data = await response.json();
    } catch {
      // No registrar excepciones del proveedor: pueden incluir IP, token o secreto.
      throw unavailable();
    }
    if (
      data === null ||
      typeof data !== 'object' ||
      !('success' in data) ||
      typeof data.success !== 'boolean'
    )
      throw unavailable();
    if (
      !data.success &&
      'error-codes' in data &&
      Array.isArray(data['error-codes']) &&
      data['error-codes'].some((code) =>
        ['invalid-input-secret', 'missing-input-secret', 'internal-error'].includes(String(code)),
      )
    )
      throw unavailable();
    if (!data.success) throw invalid();
    if (
      this.config.NODE_ENV === 'production' &&
      (!('hostname' in data) || data.hostname !== new URL(this.config.FRONTEND_URL).hostname)
    )
      throw invalid();
  }
}
