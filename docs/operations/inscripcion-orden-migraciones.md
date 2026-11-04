# Orden definitivo de migraciones del flujo final (042 a 054)

Ninguna se ha aplicado. Se aplican a mano, una por una, en este orden, con su
`inscripcion-NNN-preflight.sql` antes y `inscripcion-NNN-verificacion.sql` (termina en
ROLLBACK) después. Cada una tiene su `inscripcion-NNN-rollback.sql`. **Aplicarlas todas en
una sola ventana y desplegar backend y frontend nuevos justo después**: 042 cambia estados y
contratos, y el backend anterior deja de funcionar con ellas. Los números 055 a 059 quedaron
reservados y sin usar.

| N.º | Tarea | Qué hace | Depende de | Resultado esperado |
|---|---|---|---|---|
| 042 | F01 | Modelo final: estados, datos separados, verificaciones append-only, contadores, `app_settings`, `enrollments.origen` y columnas de identidad presencial | 007 a 041 | Tablas y columnas nuevas con RLS sin políticas; filas antiguas migradas (`pendiente_revision` pasa a `borrador` o `enviada`) |
| 043 | F02 | Endurecimiento: revoca privilegios a anon/authenticated, defaults, límites del bucket (2 MiB, JPEG/PDF) | 042 | Solo `service_role` accede a tablas y funciones; se conservan los dos helpers de Realtime |
| 044 | F07 | Reservas atómicas de límites, topes y resumen | 043 | RPC de límites y `crear_borrador_limitado`; solo `service_role` |
| 045 | F09 | Emisión y consumo de códigos serializados | 044 | `emitir_codigo_inscripcion` y `confirmar_codigo_inscripcion` |
| 046 | F10 | Consentimiento versionado (aviso y términos) | 045 | `aceptar_consentimiento_inscripcion`; la restauración puede abortar si perdería evidencia |
| 047 | F11 | Guardado atómico de datos y representante | 046 | `guardar_datos_inscripcion` y `datos_actualizados_at` |
| 048 | F12 | Guardado atómico del certificado de estudios | 047 | `guardar_certificado_inscripcion` |
| 049 | F13 | Envío y reenvío idempotentes | 048 | `enviar_solicitud_inscripcion` |
| 050 | F14 | Verificaciones del admin y listado con búsqueda escapada | 049 | RPC de verificación y listado; redefine `guard_solicitud_edit` (no la pise otra migración) |
| 051 | F15 | Decisiones: devolver, rechazar y validar la aprobación | 050 | RPC de decisión; bloqueo de correo por hash |
| 052 | F16 | Aprobación en dos pasos (reclamar y finalizar) | 051 | RPC de aprobación; escribe `origen='solicitud'` y `requisitos_verificados_at` |
| 053 | F20 | Vencimiento de devueltas y detección de huérfanos | 052 | RPC de vencimiento y de retención |
| 054 | F19 | Confirmación atómica de identidad presencial | 042 y 052 | RPC idempotente y auditada; marcas en la agenda del instructor |

Después de aplicar cada una: ejecutar su verificación, anotar la hora y no continuar si
alguna falla (usar su rollback). Pruebas manuales de red pendientes: el canal Realtime
privado (alumno e instructor autorizados, tercero rechazado), descrito en `inscripcion-043.md`.
