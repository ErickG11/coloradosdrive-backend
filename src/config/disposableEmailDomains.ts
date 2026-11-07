// Semilla local mantenible. Comparación exacta y por subdominio, sin consultas DNS/API.
// Revisar cuando soporte detecte abuso; no bloquear proveedores de correo generales.
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  'mailinator.com',
  'mailinator.net',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'yopmail.fr',
  'maildrop.cc',
  'getnada.com',
  'dispostable.com',
];
