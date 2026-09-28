import { config as loadDotenv } from 'dotenv';

loadDotenv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export const env = {
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  PORT: Number(optionalEnv('PORT', '3000')),
  FRONTEND_URL: requireEnv('FRONTEND_URL'),
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_ANON_KEY: requireEnv('SUPABASE_ANON_KEY'),
  EMAIL_USER: requireEnv('EMAIL_USER'),
  EMAIL_APP_PASSWORD: requireEnv('EMAIL_APP_PASSWORD'),
  // Gmail reescribe el remitente a la cuenta autenticada, así que el
  // "from" es siempre EMAIL_USER.
  EMAIL_FROM: requireEnv('EMAIL_USER'),
  SOLICITUD_TOKEN_SECRET: requireEnv('SOLICITUD_TOKEN_SECRET'),
};

if (env.SOLICITUD_TOKEN_SECRET.length < 32) {
  throw new Error('SOLICITUD_TOKEN_SECRET must be at least 32 characters long');
}

export const isProduction = env.NODE_ENV === 'production';
