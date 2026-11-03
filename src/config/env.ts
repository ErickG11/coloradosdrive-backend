import { config as loadDotenv } from 'dotenv';
import { loadEnrollmentConfig } from './enrollmentConfig';

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

const nodeEnv = optionalEnv('NODE_ENV', 'development');
const emailProvider = optionalEnv('EMAIL_PROVIDER', 'smtp');
if (emailProvider !== 'smtp' && emailProvider !== 'console') {
  throw new Error('EMAIL_PROVIDER debe ser smtp o console');
}
if (
  emailProvider === 'console' &&
  (nodeEnv === 'production' || process.env.RAILWAY_ENVIRONMENT !== undefined)
) {
  throw new Error(
    'EMAIL_PROVIDER=console está prohibido en production o con RAILWAY_ENVIRONMENT presente',
  );
}
function requireSmtpEnv(name: string): string {
  if (emailProvider === 'console') return optionalEnv(name, '');
  if (!process.env[name]?.trim()) {
    throw new Error(`EMAIL_PROVIDER=smtp requiere ${name}`);
  }
  return requireEnv(name);
}
const emailUser = requireSmtpEnv('EMAIL_USER');
const emailPassword = requireSmtpEnv('EMAIL_APP_PASSWORD');

export const env = {
  NODE_ENV: nodeEnv,
  EMAIL_PROVIDER: emailProvider,
  SOLICITUD_RETENCION_DIAS: Number(optionalEnv('SOLICITUD_RETENCION_DIAS', '30')),
  PRIVACY_CONTACT_EMAIL: optionalEnv(
    'PRIVACY_CONTACT_EMAIL',
    emailUser || 'privacidad@example.invalid',
  ),
  TRUST_PROXY_HOPS: Number(optionalEnv('TRUST_PROXY_HOPS', '1')),
  PORT: Number(optionalEnv('PORT', '3000')),
  FRONTEND_URL: requireEnv('FRONTEND_URL'),
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_ANON_KEY: requireEnv('SUPABASE_ANON_KEY'),
  EMAIL_USER: emailUser,
  EMAIL_APP_PASSWORD: emailPassword,
  // Gmail reescribe el remitente a la cuenta autenticada, así que el
  // "from" es siempre EMAIL_USER.
  EMAIL_FROM: emailUser || 'pruebas@example.invalid',
  SOLICITUD_TOKEN_SECRET: requireEnv('SOLICITUD_TOKEN_SECRET'),
  ...loadEnrollmentConfig(process.env),
};

if (env.SOLICITUD_TOKEN_SECRET.length < 32) {
  throw new Error('SOLICITUD_TOKEN_SECRET must be at least 32 characters long');
}

export const isProduction = env.NODE_ENV === 'production';

if (
  !Number.isInteger(env.TRUST_PROXY_HOPS) ||
  env.TRUST_PROXY_HOPS < 0 ||
  env.TRUST_PROXY_HOPS > 2
) {
  throw new Error('TRUST_PROXY_HOPS debe ser 0, 1 o 2');
}

if (!Number.isInteger(env.SOLICITUD_RETENCION_DIAS) || env.SOLICITUD_RETENCION_DIAS < 1) {
  throw new Error('SOLICITUD_RETENCION_DIAS debe ser un entero positivo');
}

if (env.EMAIL_PROVIDER === 'console') {
  console.warn('Correo en modo consola: los mensajes NO se envían, se imprimen aquí');
}
