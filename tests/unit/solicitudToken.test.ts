import { createHmac } from 'node:crypto';

import { env } from '../../src/config/env';
import { signSolicitudToken, verifySolicitudToken } from '../../src/utils/solicitudToken';

const SECRET = env.SOLICITUD_TOKEN_SECRET;
const NOW = 1_800_000_000;

function forge(header: object, payload: object, secret = SECRET): string {
  const b64 = (v: object): string => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${sig}`;
}

describe('solicitudToken', () => {
  it('firma y verifica un token válido, devolviendo el id de la solicitud', () => {
    const token = signSolicitudToken('solicitud-1', NOW);
    expect(verifySolicitudToken(token, NOW + 60)).toBe('solicitud-1');
  });

  it('rechaza un token expirado', () => {
    const token = signSolicitudToken('solicitud-1', NOW);
    expect(verifySolicitudToken(token, NOW + 60 * 60 + 1)).toBeNull();
  });

  it('rechaza un token con la firma alterada', () => {
    const token = signSolicitudToken('solicitud-1', NOW);
    const tampered = `${token.slice(0, -2)}xx`;
    expect(verifySolicitudToken(tampered, NOW)).toBeNull();
  });

  it('rechaza un payload alterado con la firma original', () => {
    const [header, , signature] = signSolicitudToken('solicitud-1', NOW).split('.');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'otra', purpose: 'solicitud', exp: NOW + 100 }),
    ).toString('base64url');
    expect(verifySolicitudToken(`${header}.${payload}.${signature}`, NOW)).toBeNull();
  });

  it('rechaza un token firmado con otro secreto', () => {
    const token = forge(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'x', purpose: 'solicitud', exp: NOW + 100 },
      'otro-secreto-completamente-distinto-1234567890',
    );
    expect(verifySolicitudToken(token, NOW)).toBeNull();
  });

  it('rechaza un token con otro propósito (p. ej. uno de otro flujo)', () => {
    const token = forge(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'x', purpose: 'otro', exp: NOW + 100 },
    );
    expect(verifySolicitudToken(token, NOW)).toBeNull();
  });

  it('rechaza alg distinto de HS256 (p. ej. "none")', () => {
    const token = forge(
      { alg: 'none', typ: 'JWT' },
      { sub: 'x', purpose: 'solicitud', exp: NOW + 100 },
    );
    expect(verifySolicitudToken(token, NOW)).toBeNull();
  });

  it.each(['', 'abc', 'a.b', 'a.b.c.d'])('rechaza basura (%p)', (token) => {
    expect(verifySolicitudToken(token, NOW)).toBeNull();
  });
});
