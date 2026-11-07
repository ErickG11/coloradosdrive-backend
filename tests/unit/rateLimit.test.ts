import express from 'express';
import request from 'supertest';

import { errorHandler } from '../../src/middlewares/errorHandler';
import { correoRateKey, buildRateLimiter } from '../../src/middlewares/rateLimit';

function buildApp(max: number): express.Express {
  const app = express();
  app.post('/accion', buildRateLimiter(max), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('buildRateLimiter', () => {
  it('permite hasta el máximo y responde 429 después, con mensaje claro', async () => {
    const app = buildApp(3);

    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).post('/accion')).status).toBe(200);
    }
    const blocked = await request(app).post('/accion');
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/Demasiadas solicitudes/);
  });

  it('no aplica cuando skip=true (usado por los tests de integración)', async () => {
    const app = express();
    app.post('/accion', buildRateLimiter(1, true), (_req, res) => {
      res.status(200).json({ ok: true });
    });

    expect((await request(app).post('/accion')).status).toBe(200);
    expect((await request(app).post('/accion')).status).toBe(200);
  });
});

// No se conserva el correo en las claves del store.
it('normaliza y resume el correo sin compartir su valor en el store', () => {
  const req = (correo: string) => ({ body: { correo } }) as express.Request;
  expect(correoRateKey(req(' Ana@Example.com '))).toBe(correoRateKey(req('ana@example.com')));
  expect(correoRateKey(req('ana@example.com'))).toMatch(/^[a-f0-9]{64}$/);
});
it('Railway confía solo en el salto configurado y no en toda la cadena', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  const response = await request(app).get('/').set('X-Forwarded-For', '198.51.100.1, 203.0.113.2');
  expect(response.body.ip).toBe('203.0.113.2');
});
