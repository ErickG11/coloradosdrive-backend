// Orígenes permitidos por CORS: FRONTEND_URL más una lista opcional (CORS_ORIGINS, separada por
// comas) para URLs de vista previa. Se compara el origen exacto (esquema + host + puerto); nunca
// se admite "*" ni comodines.
function originOf(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`CORS_ORIGINS contiene un origen inválido: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`CORS_ORIGINS solo admite http o https: ${value}`);
  return url.origin;
}

export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      if (entry.includes('*')) throw new Error('CORS_ORIGINS no admite comodines (*)');
      return originOf(entry);
    });
}

export function allowedCorsOrigins(frontendUrl: string, extra: readonly string[]): string[] {
  let primary = frontendUrl;
  try {
    primary = new URL(frontendUrl).origin;
  } catch {
    // FRONTEND_URL mal formada: se conserva tal cual, como antes.
  }
  return [...new Set([primary, ...extra])];
}
