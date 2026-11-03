// Validación pura para probar configuración sin .env, red ni importaciones de servicios.
export function loadEnrollmentConfig(source: NodeJS.ProcessEnv): {
  PRIVACY_NOTICE_VERSION: string;
  TERMS_VERSION: string;
  TERMS_REFUND_TEXT: string;
  RECENT_GRAD_MONTHS: number;
  ENROLLMENT_CODES_DAILY_CAP: number;
  ENROLLMENT_NEW_REQUESTS_DAILY_CAP: number;
  ENROLLMENT_UPLOADS_DAILY_CAP: number;
  ENROLLMENT_UPLOADS_PER_IP_DAILY_CAP: number;
  ENROLLMENT_CODES_PER_IP_HOUR: number;
  ENROLLMENT_CODES_PER_EMAIL_DAILY_CAP: number;
  ENROLLMENT_FAILED_CODES_PER_EMAIL_DAILY_CAP: number;
  ENROLLMENT_CODE_COOLDOWN_SECONDS: number;
  ENROLLMENT_RATE_HMAC_SECRET: string;
  ADMIN_MFA_REQUIRED: boolean;
  CAPTCHA_PROVIDER: 'turnstile' | 'off';
  TURNSTILE_SECRET_KEY: string;
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: string;
} {
  function text(name: string, fallback: string): string {
    const value = source[name]?.trim();
    return value === undefined || value === '' ? fallback : value;
  }
  function integer(name: string, fallback: number, min = 0, max = 1_000_000): number {
    const raw = text(name, String(fallback));
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) < min ||
      Number(raw) > max
    )
      throw new Error(`${name} debe ser un entero entre ${String(min)} y ${String(max)}`);
    return Number(raw);
  }
  function version(name: string, fallback: string): string {
    const value = text(name, fallback);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value))
      throw new Error(
        `${name} debe tener de 1 a 100 letras, dígitos, puntos, guiones o guiones bajos`,
      );
    return value;
  }
  const captcha = text('CAPTCHA_PROVIDER', source.NODE_ENV === 'production' ? 'turnstile' : 'off');
  if (captcha !== 'turnstile' && captcha !== 'off')
    throw new Error('CAPTCHA_PROVIDER debe ser turnstile u off');
  const mfa = text('ADMIN_MFA_REQUIRED', 'false');
  if (mfa !== 'true' && mfa !== 'false')
    throw new Error('ADMIN_MFA_REQUIRED debe ser true o false');
  const hmac = text('ENROLLMENT_RATE_HMAC_SECRET', source.SOLICITUD_TOKEN_SECRET ?? '');
  if (hmac.length < 32)
    throw new Error(
      'ENROLLMENT_RATE_HMAC_SECRET o SOLICITUD_TOKEN_SECRET debe tener al menos 32 caracteres',
    );
  const refund = text(
    'TERMS_REFUND_TEXT',
    'La política de reembolso está en revisión legal. Consulta las condiciones vigentes directamente con la escuela antes de realizar un pago.',
  );
  if (refund.length > 2000) throw new Error('TERMS_REFUND_TEXT no puede superar 2000 caracteres');
  return {
    PRIVACY_NOTICE_VERSION: version('PRIVACY_NOTICE_VERSION', '2026-11-borrador-v1'),
    TERMS_VERSION: version('TERMS_VERSION', '2026-11-borrador-v1'),
    TERMS_REFUND_TEXT: refund
      .normalize('NFC')
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
    RECENT_GRAD_MONTHS: integer('RECENT_GRAD_MONTHS', 12, 1, 120),
    ENROLLMENT_CODES_DAILY_CAP: integer('ENROLLMENT_CODES_DAILY_CAP', 250),
    ENROLLMENT_NEW_REQUESTS_DAILY_CAP: integer('ENROLLMENT_NEW_REQUESTS_DAILY_CAP', 150),
    ENROLLMENT_UPLOADS_DAILY_CAP: integer('ENROLLMENT_UPLOADS_DAILY_CAP', 40),
    ENROLLMENT_UPLOADS_PER_IP_DAILY_CAP: integer('ENROLLMENT_UPLOADS_PER_IP_DAILY_CAP', 5),
    ENROLLMENT_CODES_PER_IP_HOUR: integer('ENROLLMENT_CODES_PER_IP_HOUR', 60),
    ENROLLMENT_CODES_PER_EMAIL_DAILY_CAP: integer('ENROLLMENT_CODES_PER_EMAIL_DAILY_CAP', 5),
    ENROLLMENT_FAILED_CODES_PER_EMAIL_DAILY_CAP: integer(
      'ENROLLMENT_FAILED_CODES_PER_EMAIL_DAILY_CAP',
      10,
    ),
    ENROLLMENT_CODE_COOLDOWN_SECONDS: integer('ENROLLMENT_CODE_COOLDOWN_SECONDS', 60, 1, 86400),
    ENROLLMENT_RATE_HMAC_SECRET: hmac,
    ADMIN_MFA_REQUIRED: mfa === 'true',
    CAPTCHA_PROVIDER: captcha,
    TURNSTILE_SECRET_KEY: text('TURNSTILE_SECRET_KEY', ''),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: text('NEXT_PUBLIC_TURNSTILE_SITE_KEY', ''),
  };
}
