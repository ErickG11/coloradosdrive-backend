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
| CAPTCHA_PROVIDER                    | off en local; turnstile en producción | Implementación y guardas de arranque en F06                                          |
| TURNSTILE_SECRET_KEY                | Vacío                                 | Credencial solo servidor; no se devuelve en configuración pública                    |
| NEXT_PUBLIC_TURNSTILE_SITE_KEY      | Vacío                                 | Clave pública para widget y configuración de inscripción                             |

Los topes admiten cero y enteros hasta 1.000.000; cero no consume cupos y
significa agotado. Rechazar negativos, fracciones, notación exponencial e infinitos.
Ningún validador de configuración imprime valores secretos. `.env.example` contiene
solo valores ficticios/vacíos. No se modifica `.env`.

La configuración de F03 **no activa** aún captcha, MFA, límites persistentes o
nuevos endpoints; esas tareas tienen implementación y pruebas propias pendientes.

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
