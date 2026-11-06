'use strict';
// Verifica la configuración pública de Supabase Auth. No imprime claves ni datos de usuarios.
// Uso: npm run security:check-auth  (lee SUPABASE_URL y, si existe, SUPABASE_ANON_KEY del entorno o de .env)
require('dotenv').config();

async function main() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(base) && !/^http:\/\/localhost(:\d+)?$/.test(base)) {
    console.error('SUPABASE_URL ausente o con formato inválido');
    return 2;
  }
  const headers = process.env.SUPABASE_ANON_KEY ? { apikey: process.env.SUPABASE_ANON_KEY } : {};
  let res;
  try {
    res = await fetch(`${base}/auth/v1/settings`, { headers, signal: AbortSignal.timeout(10000) });
  } catch {
    console.error('No se pudo consultar /auth/v1/settings');
    return 2;
  }
  if (!res.ok) {
    console.error(`/auth/v1/settings respondió ${res.status}`);
    return 2;
  }
  const settings = await res.json();
  const fallos = [];
  if (settings.disable_signup !== true) {
    fallos.push('disable_signup no es true: el registro público está abierto y saltaría el flujo de solicitudes');
  }
  if (settings.mailer_autoconfirm !== false) {
    fallos.push('mailer_autoconfirm no es false: el correo se confirma automáticamente');
  }
  if (fallos.length > 0) {
    for (const f of fallos) console.error(`FALLA: ${f}`);
    return 1;
  }
  console.log('OK: registro público desactivado y confirmación de correo obligatoria');
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
