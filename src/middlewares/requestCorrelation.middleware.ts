import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
export const requestCorrelation: RequestHandler = (req, res, next) => {
  const correlationId = randomUUID();
  res.locals.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  res.on('finish', () => {
    // Tras un rechazo del enrutador, Express puede dejar req.params sin definir.
    const params = req.params as Record<string, string> | undefined;
    const entities = Object.values(params ?? {}).filter((v) =>
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v),
    );
    const errorCode = res.locals.errorCode as string | undefined;
    const routePath = (req.route as { path?: unknown } | undefined)?.path;
    console.warn(
      JSON.stringify({
        correlationId,
        code: errorCode ?? (res.statusCode < 400 ? 'OK' : `HTTP_${String(res.statusCode)}`),
        entities,
        operation: typeof routePath === 'string' ? routePath : 'unmatched',
        lot: 11,
        result: res.statusCode < 400 ? 'ok' : 'rejected',
      }),
    );
  });
  next();
};
