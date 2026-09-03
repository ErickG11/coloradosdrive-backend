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
  SMTP_HOST: requireEnv('SMTP_HOST'),
  SMTP_PORT: Number(requireEnv('SMTP_PORT')),
  SMTP_USER: requireEnv('SMTP_USER'),
  SMTP_PASSWORD: requireEnv('SMTP_PASSWORD'),
  SMTP_FROM: requireEnv('SMTP_FROM'),
};

export const isProduction = env.NODE_ENV === 'production';
