# ADR 003: Verificación de JWT contra el JWKS público de Supabase (no un secreto compartido)

## Estado

Aceptado.

## Contexto

El middleware `authenticate` del Sprint 1 verificaba los JWT de sesión de
Supabase Auth con `jsonwebtoken.verify(token, SUPABASE_JWT_SECRET)`
(HS256, secreto compartido). Esto dejó de funcionar: el proyecto de
Supabase usa el sistema de **JWT Signing Keys** con una clave asimétrica
(ECC P-256, algoritmo ES256) como clave activa. El "Legacy JWT secret"
del dashboard de Supabase solo sirve para verificar las API keys legacy
(anon/service_role) — **no** para los JWT de sesión de usuarios
autenticados, que se firman con la clave asimétrica.

El documento de titulación ya especifica esto literalmente (sección
"Autenticación y autorización — Supabase Auth + JWT"): "El backend
verifica la firma del token mediante la clave pública de Supabase". Esto
no es una desviación del documento, es corregir una implementación que
no lo cumplía.

## Decisión

Se verifica el JWT contra el **JWKS público del proyecto** usando
`jose` (`createRemoteJWKSet` + `jwtVerify`), el enfoque documentado por
Supabase para backends Node.js: <https://supabase.com/docs/guides/auth/jwts>.

```ts
const jwks = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

const { payload } = await jwtVerify(token, jwks, {
  issuer: `${SUPABASE_URL}/auth/v1`,
});
```

No se agregó ninguna variable de entorno nueva: la URL del JWKS se deriva
de `SUPABASE_URL`, que ya existía. `SUPABASE_JWT_SECRET` quedó sin uso en
todo el código y se eliminó de `config/env.ts` y `.env.example`.

### TODO de seguridad: claim `aud` sin validar

**Falta validar el claim `aud` del JWT — pendiente confirmar el valor
exacto que emite Supabase Auth antes de agregarlo como validación
adicional de seguridad.** La documentación de Supabase no confirma el
valor exacto esperado (hay indicios de que suele ser `"authenticated"`,
pero no está documentado como obligatorio de validar), y se prefirió no
introducir una validación basada en una suposición no confirmada. Queda
marcado con un comentario `TODO(seguridad)` en `config/jwks.ts`.

### Problema adicional: `jose` es un paquete solo-ESM

`jose` v6 se distribuye únicamente como ESM (`"type": "module"`, sin
build CommonJS). Este backend compila a CommonJS (`module: CommonJS` en
`tsconfig.json`, requisito para Node 18 LTS), y Node 18 no soporta
`require()` síncrono de paquetes ESM — esa interoperabilidad llegó a
Node en versiones posteriores a la 18. Un `import ... from 'jose'`
estático (o incluso un `import()` dinámico normal: con `module:
CommonJS`, `tsc` reescribe **todo** `import()` dinámico a
`Promise.resolve().then(() => require('jose'))`, verificado
inspeccionando el build compilado) habría roto el backend al arrancar en
Node 18, aunque funcionara sin problema en local (Node 24, que si
soporta `require()` de ESM).

Se resolvió envolviendo el import en un `Function` constructor
(`new Function('return import("jose")')`) para que `tsc` no lo reescriba
y quede un `import()` nativo real en tiempo de ejecución — el mecanismo
que Node sí soporta para cargar ESM desde CommonJS desde hace mucho más
tiempo que `require()` síncrono. Este interop vive aislado en
`config/jwks.ts` (no directo en `auth.middleware.ts`) porque un
`import()` nativo real se escapa del registro de módulos de Jest:
`jest.mock('jose', ...)` no lo intercepta. Aislarlo permite que los
tests mockeen `config/jwks.ts` completo, igual que ya se mockean
`config/supabase.ts` y `config/mailer.ts`.

### Tests: se mockea `config/jwks.ts`, no se genera un par de claves ES256 real

Los tests de integración anteriores firmaban JWTs reales (HS256) contra
un secreto de prueba compartido, dejando que el middleware los verificara
de verdad. Eso ya no es posible contra un JWKS asimétrico sin generar un
par de claves ES256 real y servir un JWKS falso en los tests — se
consideró desproporcionado para esta corrección puntual, ya que no
reduce la cobertura real de RBAC ni de la lógica de negocio (que es lo
que estos tests verifican), solo evita recrear infraestructura
criptográfica que `jose` ya prueba por su cuenta. En su lugar, se mockea
`verifySupabaseJwt` de `config/jwks.ts` directamente.

## Consecuencias

**Positivas**

- El backend verifica los JWT de sesión reales de Supabase Auth, tal
  como especifica el documento de titulación.
- Sigue funcionando correctamente en Node 18 LTS (el runtime mandado),
  no solo en el Node local del desarrollador.
- `SUPABASE_JWT_SECRET` deja de ser necesario: una variable de entorno
  menos que mantener.

**Negativas / trade-offs asumidos**

- El claim `aud` queda sin validar (ver TODO arriba) hasta confirmar su
  valor exacto.
- El interop de `jose` vía `Function` constructor es una solución poco
  común y requiere el comentario explicativo en `config/jwks.ts` para
  que no se "simplifique" por error a un `import` estático en el futuro
  (lo que rompería el backend en Node 18 de nuevo).
