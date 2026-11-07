import type { PublicRouteEntry } from '../utils/routeInventory';

// Lista blanca EXPLÍCITA de rutas sin authenticate/requireRole/authenticateSolicitud
// (S8). Toda ruta nueva sin guard hace fallar `npm run security:routes`: añadirla
// aquí exige justificar por qué es pública. Formato: método + ruta tal como la
// reporta el inventario (parámetros como :id).
export const PUBLIC_ROUTE_ALLOWLIST: readonly PublicRouteEntry[] = [
  {
    method: 'POST',
    path: '/webhooks/kushki',
    reason:
      'I11: firma HMAC cuerpo+timestamp/merchant, ventana temporal, replay persistente y verificación de importe antes de activar',
  },
  { method: 'GET', path: '/health', reason: 'Sonda de salud de la plataforma; sin datos' },
  { method: 'GET', path: '/public/courses', reason: 'Catálogo público de cursos para la landing' },
  {
    method: 'GET',
    path: '/public/aviso-privacidad',
    reason: 'Aviso de privacidad versionado, texto público',
  },
  {
    method: 'GET',
    path: '/public/inscripcion/config',
    reason: 'Configuración pública de inscripción (cursos, versiones, captcha site key)',
  },
  {
    method: 'POST',
    path: '/solicitudes/verificar-correo',
    reason: 'Inicio de inscripción: protegido por captcha, límites por correo/IP y topes diarios',
  },
  {
    method: 'POST',
    path: '/solicitudes/confirmar-codigo',
    reason:
      'Emite el token de solicitud tras validar el código de 6 dígitos; con límite de intentos',
  },
  // Rutas públicas nuevas de otros agentes: añadir aquí al final con su razón.
];
