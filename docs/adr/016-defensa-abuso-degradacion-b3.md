# ADR 016 — Defensa contra abuso y degradación (inscripción en línea)

Estado: aceptado. F43 (widget Turnstile en el frontend) queda pendiente por decisión del responsable.

## Contexto

El flujo es público y envía correo: es objetivo de bots (enumeración de cuentas, bombardeo de códigos, relleno de solicitudes, subida masiva de archivos) y, con la cuota de Gmail y el almacenamiento, un abuso barato degradaría el servicio para alumnos reales.

## Decisión

- Anti-enumeración: `verificar-correo` responde siempre el mismo mensaje y código HTTP para correo nuevo, con solicitud, con cuenta o bloqueado, con un piso de tiempo de respuesta. Los errores posibles son captcha inválido, inscripciones cerradas y cupo agotado.
- Límites por correo (1 código por 60 s, 5 al día, 10 intentos fallidos al día) y por IP (ventana horaria; IPv6 agrupada por /64). Las claves de límite son HMAC, nunca IP ni correo en claro. `TRUST_PROXY_HOPS` es 1 en producción (un proxy de Railway) y 0 en desarrollo: confiar en más saltos permitiría falsificar `X-Forwarded-For`.
- Topes globales diarios persistidos en base de datos (códigos 250, solicitudes nuevas 150, subidas 40, 5 subidas por IP) con incremento atómico. Alerta al administrador al 80 %.
- Degradación elegante: un tope de subidas agotado nunca impide inscribirse (se envía sin archivo y el administrador usa "Devolver"). Un tope de códigos o de solicitudes agotado responde `CUPO_DIARIO_AGOTADO` con orientación a WhatsApp y matrícula manual.
- Interruptor `inscripciones_abiertas` (503 `INSCRIPCIONES_CERRADAS`), auditado.
- Captcha Turnstile validado en el servidor, falla cerrado con 503 en producción; `CAPTCHA_PROVIDER=off` solo fuera de producción.
- Cuerpos JSON de 16 kb en estas rutas, archivos de 2 MiB, semáforo de procesamiento de archivos, timeouts del servidor y registros sin datos personales.

## Riesgo residual

Hasta F43, los límites por correo e IP y los topes diarios son la única barrera contra bots. Con el captcha desactivado un atacante con muchas IPs y correos desechables puede agotar los topes diarios (denegación de servicio a nuevas inscripciones, no acceso a datos). Mitigaciones disponibles: bloquear dominios desechables, bajar topes, cerrar inscripciones y derivar a WhatsApp. F43 es requisito antes de producción.

## Consecuencias

Los topes protegen la cuota de correo y almacenamiento a costa de poder rechazar a usuarios legítimos el día que se agoten; el runbook (cerrar inscripciones, subir topes, derivar por WhatsApp y matrícula manual) cubre ese caso.
