# ADR 002: Consistencia entre Supabase Auth y la fila de `users` al matricular

## Estado

Aceptado.

## Contexto

`POST /enrollments` (RF-01) crea, en una sola operación de negocio: un
usuario en Supabase Auth (vía `service_role`), una fila en `public.users`
(rol estudiante), y una fila en `enrollments`. Estos tres pasos **no**
pueden envolverse en una única transacción de Postgres: Supabase Auth
gestiona `auth.users` a través de su propia API (GoTrue), no como parte
del pool de conexión/transacción que usa `supabase-js` para el resto de
tablas en `public`.

Esto significa que si la creación del usuario en Auth tiene éxito pero un
paso posterior falla (por ejemplo, la cédula ya existe y la inserción en
`public.users` viola el constraint único, o el estudiante ya está activo
en otra cohorte y la inserción en `enrollments` viola el índice único
parcial), quedaría un usuario en `auth.users` sin fila en `public.users`
ni inscripción: una cuenta "huérfana" que puede iniciar sesión pero no
tiene perfil ni rol coherente en el sistema.

## Decisión

Se usa una **compensación manual** (patrón saga simplificado, un solo
paso de compensación) en `EnrollmentService.enrollStudent`:

1. Crear el usuario en Supabase Auth.
2. Insertar la fila en `public.users`.
3. Insertar la fila en `enrollments`.
4. Enviar el correo de bienvenida (best-effort, ver más abajo).

Si el paso 2 o el paso 3 falla, se captura el error, se llama a
`supabase.auth.admin.deleteUser(studentId)` para revertir el paso 1, y
luego se relanza el error original (traducido a un código HTTP claro si
corresponde, p. ej. 409 por cédula duplicada o cohorte activa duplicada).

El envío del correo (paso 4) es deliberadamente **best-effort**: si falla,
se registra el error en el log pero no se revierte la cuenta ni la
matrícula ya creadas — para ese punto ambas son válidas y consistentes;
fallar el envío de un correo no debería destruir un registro académico
real.

## Consecuencias

**Positivas**

- No quedan cuentas de Auth huérfanas ante los errores esperados de este
  flujo (cédula duplicada, cohorte ya activa).
- El estudiante y la cohorte quedan en un estado consistente entre sí en
  todo momento: o existen ambos (usuario + inscripción) o no existe
  ninguno.

**Negativas / trade-offs asumidos**

- No es una transacción real: existe una ventana breve (entre el paso 1 y
  el paso 2/3) donde el usuario existe en Auth pero no en `public.users`.
  Si el proceso del backend muere exactamente en ese punto (no por un
  error de validación, sino por ejemplo un corte del proceso), la
  compensación no llega a ejecutarse y sí podría quedar una cuenta
  huérfana. Se acepta este riesgo residual por ser de baja probabilidad y
  porque una solución más robusta (outbox pattern, jobs de reconciliación
  periódica) es alcance de un sprint dedicado a confiabilidad, no de
  RF-01.
- Si `deleteUser` en el paso de compensación también falla (p. ej. caída
  de red hacia Supabase Auth justo en ese momento), la cuenta huérfana sí
  queda y requeriría limpieza manual. No se reintenta automáticamente.

## Alternativas descartadas

- **Crear primero la fila en `public.users` con un `id` generado
  localmente y crear el usuario de Auth después, enlazándolo**: no es
  posible sin más cambios, porque `public.users.id` es FK directa a
  `auth.users.id` — el usuario de Auth tiene que existir primero.
- **Outbox / cola de reconciliación**: correcto a largo plazo, pero es
  una pieza de infraestructura adicional no pedida en este sprint;
  desproporcionado para RF-01.
