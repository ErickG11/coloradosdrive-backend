import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: jest.fn() } }));
import { createSolicitudAuth } from '../../src/middlewares/solicitudAuth.middleware';
import { signSolicitudToken } from '../../src/utils/solicitudToken';
import { createChain } from '../helpers/supabaseMock';
import { errorHandler } from '../../src/middlewares/errorHandler';
const id = '10000000-0000-4000-8000-000000000001';
function app(estado: string, correoVerificado = true, error: unknown = null) {
  const chain = createChain({ data: { id, estado, correo_verificado: correoVerificado }, error }),
    from = jest.fn().mockReturnValue(chain);
  const api = express();
  api.use('/solicitudes/:id', createSolicitudAuth({ from } as unknown as SupabaseClient<Database>));
  api.get('/solicitudes/:id/progreso', (_req, res) => {
    res.json({ ok: true });
  });
  api.put('/solicitudes/:id/datos', (_req, res) => {
    res.json({ ok: true });
  });
  api.use(errorHandler);
  return { api, chain, from };
}
test.each(['borrador', 'devuelta', 'enviada', 'aprobada', 'rechazada'])(
  'token de estado solo lee %s',
  async (estado) => {
    const h = app(estado),
      token = signSolicitudToken(id, undefined, 'estado');
    const read = await request(h.api)
      .get(`/solicitudes/${id}/progreso`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(
      (await request(h.api).put(`/solicitudes/${id}/datos`).set('Authorization', `Bearer ${token}`))
        .status,
    ).toBe(403);
  },
);
test.each(['borrador', 'devuelta'])('token de edición escribe en %s', async (estado) => {
  const h = app(estado);
  expect(
    (
      await request(h.api)
        .put(`/solicitudes/${id}/datos`)
        .set('Authorization', `Bearer ${signSolicitudToken(id)}`)
    ).status,
  ).toBe(200);
  expect(h.chain.eq).toHaveBeenCalledWith('id', id);
});
test.each(['enviada', 'aprobada', 'rechazada'])(
  'token viejo de edición ya no escribe tras transición a %s',
  async (estado) => {
    const h = app(estado);
    expect(
      (
        await request(h.api)
          .put(`/solicitudes/${id}/datos`)
          .set('Authorization', `Bearer ${signSolicitudToken(id)}`)
      ).status,
    ).toBe(409);
  },
);
test('token de otra solicitud y ausencia de sesión no consultan datos', async () => {
  const h = app('borrador');
  expect((await request(h.api).get(`/solicitudes/${id}/progreso`)).status).toBe(401);
  expect(
    (
      await request(h.api)
        .get(`/solicitudes/${id}/progreso`)
        .set('Authorization', `Bearer ${signSolicitudToken('otro')}`)
    ).status,
  ).toBe(403);
  expect(h.from).not.toHaveBeenCalled();
});
test('correo sin verificar y error de DB fallan cerrado', async () => {
  for (const h of [app('borrador', false), app('borrador', true, { message: 'ficticio' })]) {
    expect(
      (
        await request(h.api)
          .get(`/solicitudes/${id}/progreso`)
          .set('Authorization', `Bearer ${signSolicitudToken(id)}`)
      ).status,
    ).toBeGreaterThanOrEqual(400);
  }
});
