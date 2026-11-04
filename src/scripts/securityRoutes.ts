// Inventario de rutas: `npm run security:routes`.
// Carga la aplicación SIN iniciar un servidor ni conectar a servicios: solo
// recorre la tabla de rutas de Express. Falla (código 1) si alguna ruta no tiene
// authenticate/requireRole/authenticateSolicitud y no está en la lista blanca.
import './securityRoutesEnv';

import { createApp } from '../app';
import { PUBLIC_ROUTE_ALLOWLIST } from '../config/publicRoutes';
import { classifyRoutes, collectRoutes, formatReport } from '../utils/routeInventory';

try {
  const app = createApp() as unknown as Parameters<typeof collectRoutes>[0];
  const report = classifyRoutes(collectRoutes(app), PUBLIC_ROUTE_ALLOWLIST);
  process.stdout.write(`${formatReport(report)}\n`);
  process.exit(report.unprotected.length > 0 ? 1 : 0);
} catch (error: unknown) {
  const reason = error instanceof Error ? error.message : 'error desconocido';
  process.stderr.write(`No se pudo generar el inventario de rutas: ${reason}\n`);
  process.exit(2);
}
