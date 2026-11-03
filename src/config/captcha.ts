export interface CaptchaConfig {
  NODE_ENV: string;
  CAPTCHA_PROVIDER: 'turnstile' | 'off';
  TURNSTILE_SECRET_KEY: string;
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: string;
}
export function validateCaptchaConfiguration(config: CaptchaConfig): void {
  if (config.NODE_ENV === 'production' && config.CAPTCHA_PROVIDER === 'off')
    throw new Error('CAPTCHA_PROVIDER=off está prohibido en production');
  if (config.CAPTCHA_PROVIDER === 'turnstile') {
    if (!config.TURNSTILE_SECRET_KEY.trim())
      throw new Error('CAPTCHA_PROVIDER=turnstile requiere TURNSTILE_SECRET_KEY');
    if (!config.NEXT_PUBLIC_TURNSTILE_SITE_KEY.trim())
      throw new Error('CAPTCHA_PROVIDER=turnstile requiere NEXT_PUBLIC_TURNSTILE_SITE_KEY');
    if (
      config.NODE_ENV === 'production' &&
      (/^[123]x0+AA$/.test(config.TURNSTILE_SECRET_KEY) ||
        /^[123]x0+(AA|AB|BB|FF)$/.test(config.NEXT_PUBLIC_TURNSTILE_SITE_KEY))
    )
      throw new Error('Las claves de prueba de Turnstile están prohibidas en production');
  }
}
