import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

const TTL = 3600;
export const SOLICITUD_TOKEN_ISSUER = 'coloradosdrive-backend';
export const SOLICITUD_TOKEN_AUDIENCE = 'coloradosdrive:inscripcion';
export type SolicitudScope = 'edicion' | 'estado';
export interface SolicitudClaims {
  solicitudId: string;
  scope: SolicitudScope;
  exp: number;
}
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const signature = (value: string): Buffer =>
  createHmac('sha256', env.SOLICITUD_TOKEN_SECRET).update(value).digest();
// Mantiene segundo argumento de reloj para tests; todo emisor nuevo fija scope explícito.
export function signSolicitudToken(
  id: string,
  now = Math.floor(Date.now() / 1000),
  scope: SolicitudScope = 'edicion',
): string {
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: id,
    purpose: 'solicitud',
    scope,
    aud: SOLICITUD_TOKEN_AUDIENCE,
    iss: SOLICITUD_TOKEN_ISSUER,
    iat: now,
    exp: now + TTL,
  })}`;
  return `${input}.${signature(input).toString('base64url')}`;
}
export function verifySolicitudClaims(
  token: string,
  now = Math.floor(Date.now() / 1000),
): SolicitudClaims | null {
  if (token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [head, body, sig] = parts;
    const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || header.crit !== undefined) return null;
    const received = Buffer.from(sig, 'base64url'),
      expected = signature(`${head}.${body}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      p.purpose !== 'solicitud' ||
      p.aud !== SOLICITUD_TOKEN_AUDIENCE ||
      p.iss !== SOLICITUD_TOKEN_ISSUER ||
      typeof p.sub !== 'string' ||
      !p.sub ||
      p.sub.length > 64 ||
      (p.scope !== 'edicion' && p.scope !== 'estado') ||
      typeof p.iat !== 'number' ||
      !Number.isSafeInteger(p.iat) ||
      p.iat > now + 30 ||
      typeof p.exp !== 'number' ||
      !Number.isSafeInteger(p.exp) ||
      p.exp <= now ||
      p.exp <= p.iat ||
      p.exp - p.iat > TTL
    )
      return null;
    return { solicitudId: p.sub, scope: p.scope, exp: p.exp };
  } catch {
    return null;
  }
}
export function verifySolicitudToken(
  token: string,
  now = Math.floor(Date.now() / 1000),
): string | null {
  return verifySolicitudClaims(token, now)?.solicitudId ?? null;
}
