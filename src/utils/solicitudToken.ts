import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../config/env';

// Token temporal del flujo público de solicitudes de inscripción. Es un
// JWT HS256 firmado con SOLICITUD_TOKEN_SECRET, de uso exclusivo de este
// flujo (claim purpose): nunca es válido como JWT de Supabase Auth, ni al
// revés. Se implementa con node:crypto (no `jose`) porque jose v6 es solo
// ESM y su interop en este backend CommonJS vive aislado en config/jwks.ts.

const TOKEN_TTL_SECONDS = 60 * 60;
const PURPOSE = 'solicitud';
const HEADER = { alg: 'HS256', typ: 'JWT' };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): Buffer {
  return createHmac('sha256', env.SOLICITUD_TOKEN_SECRET).update(data).digest();
}

export function signSolicitudToken(
  solicitudId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload = {
    sub: solicitudId,
    purpose: PURPOSE,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };
  const signingInput = `${base64url(JSON.stringify(HEADER))}.${base64url(JSON.stringify(payload))}`;
  return `${signingInput}.${base64url(sign(signingInput))}`;
}

/**
 * Devuelve el id de la solicitud si el token es válido (firma, algoritmo,
 * propósito y expiración); null en cualquier otro caso.
 */
export function verifySolicitudToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as {
      alg?: unknown;
    };
    if (header.alg !== HEADER.alg) {
      return null;
    }

    const expected = sign(`${encodedHeader}.${encodedPayload}`);
    const received = Buffer.from(encodedSignature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      sub?: unknown;
      purpose?: unknown;
      exp?: unknown;
    };
    if (
      payload.purpose !== PURPOSE ||
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= nowSeconds
    ) {
      return null;
    }

    return payload.sub;
  } catch {
    return null;
  }
}
