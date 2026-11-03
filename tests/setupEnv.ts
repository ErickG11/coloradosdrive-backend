// Dummy env vars for tests that load config/env.ts and config/supabase.ts.
// Supabase clients are constructed lazily (no network call at creation
// time), so these values only need to be well-formed, not real.
process.env.NODE_ENV = 'test';
process.env.DISABLE_CRON = 'true';
process.env.PORT = '3000';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.EMAIL_USER = 'test-sender@test.local';
process.env.EMAIL_PROVIDER = 'smtp';
process.env.EMAIL_APP_PASSWORD = 'test-app-password';
process.env.SOLICITUD_TOKEN_SECRET = 'test-solicitud-token-secret-0123456789abcdef';
process.env.TURNSTILE_SECRET_KEY = 'turnstile-secret-ficticio-solo-tests';
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'turnstile-sitekey-ficticia-solo-tests';
process.env.CAPTCHA_PROVIDER = 'off';
