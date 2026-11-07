# ADR 017 — Enlace de un solo uso para crear la contraseña

Estado: aceptado. Sustituye el envío de contraseña temporal por correo en el flujo de solicitudes (la matrícula manual no cambia).

## Contexto

Enviar contraseñas por correo las deja en buzones y copias indefinidamente. Los escáneres de correo, además, abren los enlaces y pueden consumir un token válido antes que la persona.

## Decisión

- La aprobación crea la cuenta de Auth SIN contraseña (correo confirmado, rol `estudiante` en `app_metadata`). Nunca se envía una contraseña.
- El enlace se genera con `generateLink` de Supabase Auth (recovery o invite según el SDK), se toma `hashed_token` y se arma `{FRONTEND_URL}/crear-contrasena?token_hash=...&type=...`. No se usa `action_link`. El correo contiene solo el origen de `FRONTEND_URL` y el `token_hash`.
- `/crear-contrasena` no consume el token al cargar: lo consume el botón "Crear mi contraseña" (`verifyOtp` con `token_hash`). Lee los parámetros, los borra de la URL con `history.replaceState`, es `noindex` y declara `Referrer-Policy: no-referrer`.
- Contraseña de al menos 10 caracteres con confirmación. Enlace vencido o usado: mensaje claro y el administrador puede reenviar uno nuevo (endpoint auditado).
- El token se trata como secreto: no se registra en logs ni en auditoría.

## Consecuencias

Si el correo nunca llega, la cuenta queda sin acceso hasta reenviar el enlace; es un estado válido y visible para el administrador. La caducidad del enlace depende de la configuración de Auth (paso manual documentado).
