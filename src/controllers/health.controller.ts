import type { Request, Response } from 'express';

interface HealthResponseBody {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export function getHealth(_req: Request, res: Response<HealthResponseBody>): void {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}
