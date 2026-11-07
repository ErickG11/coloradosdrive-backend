import type { Express } from 'express';
import request from 'supertest';

import { allowedCorsOrigins, parseCorsOrigins } from '../../src/config/cors';

describe('orígenes de CORS', () => {
  it('normaliza FRONTEND_URL al origen (sin barra final ni ruta)', () => {
    expect(allowedCorsOrigins('https://app.vercel.app/inicio/', [])).toEqual([
      'https://app.vercel.app',
    ]);
  });

  it('suma los orígenes extra sin duplicados', () => {
    expect(
      allowedCorsOrigins('https://app.vercel.app', ['https://app.vercel.app', 'https://p.vercel.app']),
    ).toEqual(['https://app.vercel.app', 'https://p.vercel.app']);
  });

  it('parseCorsOrigins ignora vacíos y recorta espacios', () => {
    expect(parseCorsOrigins(' https://a.example , ,https://b.example:8443/x ')).toEqual([
      'https://a.example',
      'https://b.example:8443',
    ]);
    expect(parseCorsOrigins('')).toEqual([]);
  });

  it('rechaza comodines y esquemas no web', () => {
    expect(() => parseCorsOrigins('*')).toThrow('comodines');
    expect(() => parseCorsOrigins('mailto:a@b.c')).toThrow('http o https');
  });
});

describe('CORS del backend con origen adicional', () => {
  const previous = { ...process.env };
  afterEach(() => {
    process.env = { ...previous };
    jest.resetModules();
  });

  async function app(): Promise<Express> {
    process.env.CORS_ORIGINS = 'https://preview.vercel.app';
    jest.resetModules();
    const { createApp } = (await import('../../src/app')) as { createApp: () => Express };
    return createApp();
  }

  it('acepta FRONTEND_URL y el origen adicional, y rechaza otros', async () => {
    const server = await app();
    const frontend = new URL(process.env.FRONTEND_URL ?? '').origin;
    for (const [origin, permitido] of [
      [frontend, true],
      ['https://preview.vercel.app', true],
      ['https://otro.example', false],
    ] as const) {
      const res = await request(server).get('/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(permitido ? origin : undefined);
    }
  });
});
