// Debe importarse ANTES que la aplicación: env.ts valida las variables al cargarse.
// Valores ficticios solo para que la validación pase; no son credenciales y el
// inventario de rutas no abre ninguna conexión.
const placeholders: Record<string, string> = {
  FRONTEND_URL: 'http://localhost:3001',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service-role',
  SUPABASE_ANON_KEY: 'placeholder-anon',
  SOLICITUD_TOKEN_SECRET: 'placeholder-token-secret-for-route-inventory-only',
};
for (const [name, value] of Object.entries(placeholders)) process.env[name] ??= value;
process.env.NODE_ENV = 'test';
process.env.EMAIL_PROVIDER = 'console';
process.env.CAPTCHA_PROVIDER = 'off';
delete process.env.RAILWAY_ENVIRONMENT;
