// Registro de middlewares de autorización. Los guards de Express son funciones
// anónimas (requireRole devuelve un cierre), así que el inventario de rutas
// (utils/routeInventory.ts) no puede reconocerlos por nombre: se marcan aquí.

export type GuardKind = 'authenticate' | 'requireRole' | 'authenticateSolicitud';

const registry = new WeakMap<object, GuardKind>();

export function markGuard<T extends object>(handler: T, kind: GuardKind): T {
  registry.set(handler, kind);
  return handler;
}

export function guardKindOf(handler: unknown): GuardKind | undefined {
  return typeof handler === 'function' ? registry.get(handler) : undefined;
}
