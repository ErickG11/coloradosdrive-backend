import { guardKindOf, type GuardKind } from './routeGuards';

// Inventario de rutas (S8): recorre la tabla de rutas de Express 4
// (app._router.stack y los routers montados) y lista cada ruta con sus
// middlewares. Una ruta es "protegida" si lleva authenticate, requireRole o
// authenticateSolicitud, ya sea propio o heredado de un router.use(...) previo.
// Lo demás debe estar en una lista blanca explícita de rutas públicas.

interface ExpressLayer {
  name?: string;
  handle: unknown;
  regexp?: RegExp & { fast_slash?: boolean };
  keys?: { name: string | number }[];
  route?: ExpressRoute;
  method?: string;
}

interface ExpressRoute {
  path: unknown;
  stack: ExpressLayer[];
  methods: Record<string, boolean>;
}

export interface InventoryRoute {
  method: string;
  path: string;
  middlewares: string[];
  guards: GuardKind[];
}

export type RouteStatus = 'protected' | 'public' | 'unprotected';

export interface ClassifiedRoute extends InventoryRoute {
  status: RouteStatus;
  publicReason?: string;
}

export interface PublicRouteEntry {
  method: string;
  path: string;
  reason: string;
}

export interface InventoryReport {
  routes: ClassifiedRoute[];
  unprotected: ClassifiedRoute[];
  // Entradas de la lista blanca que ya no existen (aviso, no falla).
  staleAllowlist: PublicRouteEntry[];
  // Entradas de la lista blanca que sí llevan guard (aviso: probablemente sobran).
  protectedButAllowlisted: ClassifiedRoute[];
}

const PROTECTING_GUARDS: readonly GuardKind[] = [
  'authenticate',
  'requireRole',
  'authenticateSolicitud',
];

interface InheritedGuard {
  kind: GuardKind;
  prefix: string;
}

function mountPathOf(layer: ExpressLayer): string {
  const regexp = layer.regexp;
  if (!regexp || regexp.fast_slash) return '';
  let index = 0;
  return regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${String(layer.keys?.[index++]?.name ?? 'param')}`)
    .replace(/\\\//g, '/');
}

function joinPaths(base: string, path: string): string {
  const joined = `${base}${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined || '/';
}

function handlerName(handler: unknown): string {
  const kind = guardKindOf(handler);
  if (kind) return kind;
  return typeof handler === 'function' && handler.name ? handler.name : '<anonymous>';
}

function walk(
  stack: ExpressLayer[],
  basePath: string,
  inherited: InheritedGuard[],
  out: InventoryRoute[],
): void {
  // Los guards de un router.use(...) solo cubren lo declarado después.
  const accumulated = [...inherited];
  for (const layer of stack) {
    if (layer.route) {
      const route = layer.route;
      const routePath = joinPaths(basePath, Array.isArray(route.path) ? route.path.map(String).join('|') : String(route.path));
      const own = route.stack.map((entry) => entry.handle);
      const guards = [
        ...accumulated.filter((g) => routePath.startsWith(g.prefix)).map((g) => g.kind),
        ...own.flatMap((handler) => guardKindOf(handler) ?? []),
      ];
      const middlewares = [
        ...accumulated.filter((g) => routePath.startsWith(g.prefix)).map((g) => g.kind),
        ...own.map(handlerName),
      ];
      for (const method of Object.keys(route.methods).filter((m) => route.methods[m])) {
        out.push({ method: method.toUpperCase(), path: routePath, middlewares, guards });
      }
      continue;
    }
    const mount = joinPaths(basePath, mountPathOf(layer));
    const nested = (layer.handle as { stack?: ExpressLayer[] } | undefined)?.stack;
    if (layer.name === 'router' && Array.isArray(nested)) {
      walk(nested, mount, accumulated, out);
      continue;
    }
    const kind = guardKindOf(layer.handle);
    if (kind) accumulated.push({ kind, prefix: mount === '/' ? '' : mount });
  }
}

export function collectRoutes(app: { _router?: { stack: ExpressLayer[] } }): InventoryRoute[] {
  if (!app._router) throw new Error('La aplicación de Express no tiene tabla de rutas');
  const routes: InventoryRoute[] = [];
  walk(app._router.stack, '', [], routes);
  return routes.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}

export function classifyRoutes(
  routes: InventoryRoute[],
  allowlist: readonly PublicRouteEntry[],
): InventoryReport {
  const allowed = new Map(allowlist.map((entry) => [`${entry.method.toUpperCase()} ${entry.path}`, entry]));
  const seen = new Set<string>();
  const classified = routes.map((route): ClassifiedRoute => {
    const key = `${route.method} ${route.path}`;
    const entry = allowed.get(key);
    if (entry) seen.add(key);
    if (route.guards.some((guard) => PROTECTING_GUARDS.includes(guard))) {
      return { ...route, status: 'protected' };
    }
    return entry
      ? { ...route, status: 'public', publicReason: entry.reason }
      : { ...route, status: 'unprotected' };
  });
  return {
    routes: classified,
    unprotected: classified.filter((route) => route.status === 'unprotected'),
    staleAllowlist: allowlist.filter((entry) => !seen.has(`${entry.method.toUpperCase()} ${entry.path}`)),
    protectedButAllowlisted: classified.filter(
      (route) => route.status === 'protected' && allowed.has(`${route.method} ${route.path}`),
    ),
  };
}

export function formatReport(report: InventoryReport): string {
  const lines = report.routes.map(
    (route) =>
      `${route.status.toUpperCase().padEnd(11)} ${route.method.padEnd(6)} ${route.path}  [${route.middlewares.join(', ')}]`,
  );
  const counts = (status: RouteStatus): number => report.routes.filter((r) => r.status === status).length;
  lines.push(
    '',
    `Total ${String(report.routes.length)} · protegidas ${String(counts('protected'))} · públicas autorizadas ${String(counts('public'))} · SIN PROTECCIÓN ${String(counts('unprotected'))}`,
  );
  for (const route of report.unprotected) {
    lines.push(`FALLA: ${route.method} ${route.path} no tiene authenticate/requireRole/authenticateSolicitud ni está en la lista blanca`);
  }
  for (const entry of report.staleAllowlist) {
    lines.push(`AVISO: la lista blanca contiene una ruta inexistente: ${entry.method} ${entry.path}`);
  }
  for (const route of report.protectedButAllowlisted) {
    lines.push(`AVISO: ${route.method} ${route.path} está en la lista blanca pero ya lleva guard`);
  }
  return lines.join('\n');
}
