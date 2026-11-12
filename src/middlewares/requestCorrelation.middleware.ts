import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
export const requestCorrelation: RequestHandler = (req, res, next) => {
  const correlationId = randomUUID();
  res.locals.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  res.on('finish', () => {
    const entities = Object.values(req.params).filter((v) =>
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v),
    );
    console.warn(
      JSON.stringify({
        correlationId,
        code: res.locals.errorCode ?? (res.statusCode < 400 ? 'OK' : 'HTTP_' + res.statusCode),
        entities,
        operation: typeof req.route?.path === 'string' ? req.route.path : 'unmatched',
        lot: 11,
        result: res.statusCode < 400 ? 'ok' : 'rejected',
      }),
    );
  });
  next();
};
