# Runtime Node 22 del backend

El runtime declarado es **Node 22** (`engines.node`: `>=22 <23`). El CI
usa Node 22 e incluye compilación. El lockfile cambia únicamente el engine
del paquete raíz; no se actualizó ninguna dependencia.

## Motivo

`jose@6.2.10` (verificación de JWT de Supabase) usa `crypto.subtle.importKey` y
requiere Web Crypto y Fetch globales. En Node 18 `globalThis.crypto` es
`undefined` y la verificación de un JWT ES256 falla con
`ReferenceError: crypto is not defined`; en Node 22 existe. No es un problema de
carga ESM: el `import()` nativo de `src/config/jwks.ts` funciona y se conserva,
solo se actualizó su comentario. `@supabase/supabase-js@2.114.0` también exige
Node >=22, y los rangos de `engines` del lockfile aceptan Node 22.

## Soporte

Node 22 está en mantenimiento LTS hasta el **30-04-2027**
([calendario oficial](https://github.com/nodejs/Release/blob/main/schedule.json)).
Node 18 terminó su soporte el 30-04-2025. La próxima migración de major queda
fuera de este cambio.

## Railway

No hay Dockerfile, `railway.json`, `nixpacks.toml`, `.nvmrc` ni `.node-version`;
la señal versionada para Railway es `package.json`. Antes del siguiente
despliegue hay que confirmar el builder efectivo, retirar cualquier override de
Node 18 (`RAILPACK_NODE_VERSION` o `NIXPACKS_NODE_VERSION`) y verificar que la
versión construida cumple `>=22 <23`.
