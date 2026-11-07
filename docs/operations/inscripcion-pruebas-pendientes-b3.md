# Pruebas pendientes B3

## F22
- routeInventory: ruta sin guard falla; guard heredado de router.use cubre rutas posteriores y no las
  anteriores; allowlist obsoleta solo avisa; rutas con parámetros; guard envuelto en asyncHandler.
- postgrestSearch: `%`, `_`, `\`, comas, paréntesis, puntos, comillas, `*`, controles y RTL override;
  longitud máxima 80; término vacío devuelve null (sin .or).
- Integración HTTP: cuerpo > 16 kb en /solicitudes responde 413 CUERPO_DEMASIADO_GRANDE; JSON roto 400
  JSON_INVALIDO sin eco del cuerpo; en rutas no de inscripción el límite sigue en 100 kb.
- CORS: origen exacto permitido, otro origen sin cabecera; FRONTEND_URL con barra final.
- Cabeceras: Cache-Control no-store en todas las respuestas, CSP y Referrer-Policy.
- safeLog: summarizeError no incluye message; código con caracteres raros se omite.
- serverHardening.applyServerTimeouts asigna los tres timeouts; tolera undefined.

## F24
- Verificar en el repositorio remoto que el workflow de secretos corre (una organización requeriría licencia)
  y que dependabot abre PRs.

## F42
- gmailApiMailer con fetch simulado: éxito (MIME base64url, Bcc), caché de token, expiración, 401 con un
  único reintento y segundo 401 falla, invalid_grant, scope sin gmail.send, red caída/timeout, errores sin
  secretos ni destinatarios.
- env: gmail_api exige EMAIL_USER y GMAIL_*; smtp y console sin cambios; console prohibido en producción.
