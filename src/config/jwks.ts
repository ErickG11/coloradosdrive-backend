import type * as Jose from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';

import { env } from './env';

// Supabase Auth firma los JWT de sesión con su clave asimétrica (JWT
// Signing Keys, ECC P-256/ES256) — SUPABASE_JWT_SECRET (el "Legacy JWT
// secret" compartido) ya no sirve para verificarlos, solo cubre las
// API keys legacy (anon/service_role). Se verifica contra el JWKS
// público del proyecto, igual que documenta Supabase para backends
// Node.js: https://supabase.com/docs/guides/auth/jwts
//
// `jose` v6 se distribuye solo como ESM ("type": "module", sin build
// CommonJS). Este backend compila a CommonJS (module: CommonJS en
// tsconfig.json, para Node 18 LTS), y Node 18 no soporta require()
// síncrono de paquetes ESM — esa interoperabilidad llegó a Node en
// versiones posteriores.
//
// Un `import('jose')` dinámico normal no alcanza: con module: CommonJS,
// tsc reescribe TODO import() dinámico a
// `Promise.resolve().then(() => require('jose'))` (verificado en el
// build compilado), que sigue siendo un require() síncrono por debajo y
// rompería igual en Node 18. Se envuelve en un Function constructor para
// que tsc no lo toque y quede un import() nativo real en tiempo de
// ejecución — el mecanismo que Node sí soporta para cargar ESM desde
// CommonJS desde hace mucho más tiempo que require() síncrono de ESM.
//
// Este interop vive en su propio módulo (en vez de directo en
// auth.middleware.ts) porque un import() nativo real se escapa del
// registro de módulos de Jest: jest.mock('jose', ...) no lo intercepta.
// Aislarlo aquí permite que los tests mockeen este módulo completo
// (igual que ya mockean config/supabase.ts y config/mailer.ts) sin
// pelear con jose ni con el interop ESM/CommonJS.
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- import() nativo real, no eval de código dinámico
const importJose = new Function('return import("jose")') as () => Promise<typeof Jose>;

let josePromise: Promise<typeof Jose> | undefined;

function getJose(): Promise<typeof Jose> {
  josePromise ??= importJose();
  return josePromise;
}

// createRemoteJWKSet resuelve la clave por `kid` y cachea el JWKS en
// memoria (Supabase ya lo cachea 10 min en su borde), así que esto no
// hace una request de red en cada verificación.
let jwksPromise: Promise<JWTVerifyGetKey> | undefined;

function getJwks(): Promise<JWTVerifyGetKey> {
  jwksPromise ??= getJose().then(({ createRemoteJWKSet }) =>
    createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`)),
  );
  return jwksPromise;
}

/**
 * Verifica un JWT de sesión de Supabase Auth contra el JWKS público del
 * proyecto. Lanza si la firma, la expiración o el issuer no son válidos.
 */
export async function verifySupabaseJwt(token: string): Promise<JWTPayload> {
  const [{ jwtVerify }, jwks] = await Promise.all([getJose(), getJwks()]);

  // TODO(seguridad): falta validar el claim "aud" del JWT — pendiente
  // confirmar el valor exacto que emite Supabase Auth antes de
  // agregarlo como validación adicional (ver ADR 003).
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${env.SUPABASE_URL}/auth/v1`,
  });

  return payload;
}
