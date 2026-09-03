// Dummy env vars for tests that load config/env.ts and config/supabase.ts.
// Supabase clients are constructed lazily (no network call at creation
// time), so these values only need to be well-formed, not real.
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_PORT = '465';
process.env.SMTP_USER = 'test-smtp-user';
process.env.SMTP_PASSWORD = 'test-smtp-password';
process.env.SMTP_FROM = 'no-reply@test.local';
