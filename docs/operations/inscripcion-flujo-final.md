# Inscripción final · implementación por fases

Estado de continuidad en `inscripcion-progreso.md`; reconciliación en
`inscripcion-reconciliacion.md`. Este documento sustituirá los contratos antiguos
cuando termine la implementación. **No desplegar las fases incompletas ni aplicar
042/043 con el backend anterior.** No se ha aplicado SQL a Supabase.

Orden manual previsto: preflight/verificación/rollback de 042, luego los de 043;
leer `inscripcion-043.md` para las excepciones autorizadas y prueba de Realtime.

## Configuración (F03)

| Variable                            | Default                               | Uso                                                                                  |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| PRIVACY_NOTICE_VERSION              | 2026-10-v1                            | Versión configurable; se conserva default anterior hasta sustituir aviso en F10      |
| TERMS_VERSION                       | 2026-11-borrador-v1                   | Aceptación independiente de términos                                                 |
| TERMS_REFUND_TEXT                   | Texto neutro «en revisión legal»      | Máximo 2000 caracteres; sin política de devolución inventada                         |
| RECENT_GRAD_MONTHS                  | 12                                    | Umbral de graduación reciente, 1–120 meses                                           |
| ENROLLMENT_CODES_DAILY_CAP          | 250                                   | Tope global diario de códigos                                                        |
| ENROLLMENT_NEW_REQUESTS_DAILY_CAP   | 150                                   | Tope global diario de expedientes nuevos                                             |
| ENROLLMENT_UPLOADS_DAILY_CAP        | 40                                    | Tope global diario de intentos de subida                                             |
| ENROLLMENT_UPLOADS_PER_IP_DAILY_CAP | 5                                     | Intentos de subida diarios por grupo de IP                                           |
| ENROLLMENT_CODES_PER_IP_HOUR        | 60                                    | Solicitudes de código por grupo de IP/hora                                           |
| ENROLLMENT_RATE_HMAC_SECRET         | SOLICITUD_TOKEN_SECRET                | Secreto dedicado opcional, mínimo 32 caracteres; F07 separará contexto criptográfico |
| ADMIN_MFA_REQUIRED                  | false                                 | Enrolar primero; activar solo después de F21/F39                                     |
| CAPTCHA_PROVIDER                    | off en local; turnstile en producción | Validación activa en backend desde F06                                               |
| TURNSTILE_SECRET_KEY                | Vacío                                 | Credencial solo servidor; no se devuelve en configuración pública                    |
| NEXT_PUBLIC_TURNSTILE_SITE_KEY      | Vacío                                 | Clave pública para widget y configuración de inscripción                             |

Los topes admiten cero y enteros hasta 1.000.000; cero no consume cupos y
significa agotado. Rechazar negativos, fracciones, notación exponencial e infinitos.
Ningún validador de configuración imprime valores secretos. `.env.example` contiene
solo valores ficticios/vacíos. No se modifica `.env`.

F03 solo define configuración; F06 activa la validación de captcha en el backend.
MFA, límites persistentes y los endpoints restantes siguen pendientes de sus tareas.

## Catálogos del servidor

`src/config/enrollmentCatalog.ts` define niveles, nacionalidades, tipos de sangre,
estados, motivos y mensajes, métodos y checklist físico. `menos_de_decimo` y
`extranjero_sin_cedula` se muestran para explicar el bloqueo/derivación, pero no
pueden guardarse en 042. Bachiller no pide archivo; reciente lo recomienda;
exterior, décimo y cursando exigen su subtipo específico.

La constante `METODOS_VALIDOS_APROBACION` es la única lista de métodos que
habilitarán aprobación: identidad solo Registro Civil; estudios bachiller* solo
Ministerio; otros niveles QR/llamada/original. `revision_visual` nunca habilita.
`registro_civil_web_service` existe en catálogo pero queda fuera de métodos
manuales: no se construye integración externa.

Los documentos físicos conservan los nombres de `enrollment_documents`, incluido
`titulo_bachiller` para original del certificado. Ninguno bloquea pago por defecto.
La obligación del certificado físico dependerá del nivel; votación exenta desde 65.

## Saneamiento (F04)

`enrollmentSanitization.ts` centraliza NFC, recorte y espacios, elimina controles
y caracteres de formato (incluidos ancho cero y anulación bidi). Las validaciones
posteriores rechazan HTML en nombres; limpiar controles no convierte HTML en una
entrada válida. `requireKnownFields` admite solo objetos planos y claves propias
permitidas, incluidas comprobaciones contra constructor y **proto**.

El correo para entrega conserva puntos y etiquetas, en minúsculas; la clave de
comparación Gmail/googlemail quita puntos y +etiqueta y usa gmail.com. Otros
proveedores conservan puntos/etiquetas. Los dominios IDNA pasan a ASCII sin red.
La función SQL de 042 compara el correo ya normalizado con la misma regla Gmail.
El servicio usará esa clave al adoptar el contrato final en F09.

Lista mantenible de desechables: `src/config/disposableEmailDomains.ts`. Bloquea
dominio exacto y subdominios, no proveedores con nombres parecidos ni coincidencias
de sufijos arbitrarios. Se puede ampliar tras revisar falsos positivos con soporte.
No consulta servicios externos. El normalizador de correo existente ya delega en
esta utilidad, sin revelar direcciones en errores ni logs.

## Validadores del contrato final (F05)

`enrollmentValidation.ts` contiene validadores puros con `AppError.code` y `field`:
nombres/apellidos 2–60 (NFC, letras, apóstrofe, guion y espacios), cédula mediante
el validador único `cedula.ts`, teléfono local/+593, sangre y nacionalidad de catálogo,
fecha real no futura y edad máxima 100. La mínima depende del curso; se exige
representante autorizado y distinto si la persona es menor de 18 y el curso lo
permite. La edad usa el día civil de Guayaquil, no la fecha UTC.

El código se mantiene como string de seis dígitos, incluidos ceros iniciales.
Niveles bloqueados no salen del validador; el subtipo debe corresponder al nivel.
Datos se guardarán primero; nivel de estudios puede completarse en el paso siguiente,
y enviar exigirá ambos. La entrada `nacionalidadTipo` usa camelCase como el resto
del contrato TypeScript; la columna SQL sigue llamándose `nacionalidad_tipo`.

Las decisiones no aceptan actor, studentId, estado ni timestamps del cliente.
Cada motivo usa su mensaje predefinido; solo OTRO exige mensaje plano de 10–300
caracteres. VENCIDA es interno del job, no una decisión manual. Aprobar no tiene
motivo de catálogo (el brief no define uno); no se inventa un código de aprobación.
La nota interna se devuelve separada del mensaje en el DTO del servidor y nunca
deberá exponerse en progreso/correos. Verificaciones no aceptan actor del cliente;
el web service previsto no se puede registrar como método manual.

Estos validadores se conectarán a los contratos nuevos en F09–F15. Las rutas
actuales conservan temporalmente su contrato hasta esa sustitución, documentada
para despliegue conjunto; F05 no presume endpoints ya adaptados.

## Captcha del servidor (F06)

Antes de emitir códigos, el servidor valida captchaToken contra Siteverify con
secret, response y remoteip tomado de Express. No sigue redirects y corta a los
5 segundos; no registra cuerpos, tokens, IP ni excepciones del proveedor. El
límite IP existente precede al captcha; los límites persistentes HMAC se conectarán
al completar F07. La caída/timeout/JSON inválido/fallo de configuración del proveedor
produce 503 VERIFICACION_NO_DISPONIBLE con sugerencia de contacto por WhatsApp;
un token rechazado produce 400 CAPTCHA_INVALIDO. No se accede a DB ni correo si
el middleware rechaza la verificación. En producción se exige hostname igual al
host de FRONTEND_URL.

CAPTCHA_PROVIDER=off funciona solo fuera de production, sin claves ni red.
Turnstile exige ambas claves al arrancar; producción también rechaza las claves
dummy. Para probar widget local cuando esté F27:

```dotenv
CAPTCHA_PROVIDER=turnstile
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

Son claves **públicas de prueba** documentadas por Cloudflare, no credenciales.
Nunca usarlas en producción. El widget todavía se construirá en F27; local puede
seguir con off. Fuentes:
[Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
[claves de prueba](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
