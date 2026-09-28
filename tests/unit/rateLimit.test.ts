import express from 'express';
import request from 'supertest';

import { errorHandler } from '../../src/middlewares/errorHandler';
import { buildRateLimiter } from '../../src/middlewares/rateLimit';

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
