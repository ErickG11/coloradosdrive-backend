# Orden definitivo de migraciones del flujo final (042 a 054)

Ninguna se ha aplicado. Se aplican a mano, una por una, en este orden, con su
`inscripcion-NNN-preflight.sql` antes y `inscripcion-NNN-verificacion.sql` (termina en
ROLLBACK) después. Cada una tiene su `inscripcion-NNN-rollback.sql`. **Aplicarlas todas en
una sola ventana y desplegar backend y frontend nuevos justo después**: 042 cambia estados y
contratos, y el backend anterior deja de funcionar con ellas. Los números 055 a 059 quedaron
reservados y sin usar.

| N.º | Tarea | Qué hace                                                                                                                                                | Depende de | Resultado esperado                                                                                                           |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 042 | F01   | Modelo final: estados, datos separados, verificaciones append-only, contadores, `app_settings`, `enrollments.origen` y columnas de identidad presencial | 007 a 041  | Tablas y columnas nuevas con RLS sin políticas; filas antiguas migradas (`pendiente_revision` pasa a `borrador` o `enviada`) |
| 043 | F02   | Endurecimiento: revoca privilegios a anon/authenticated, defaults, límites del bucket (2 MiB, JPEG/PDF)                                                 | 042        | Solo `service_role` accede a tablas y funciones; se conservan los dos helpers de Realtime                                    |
| 044 | F07   | Reservas atómicas de límites, topes y resumen                                                                                                           | 043        | RPC de límites y `crear_borrador_limitado`; solo `service_role`                                                              |
| 045 | F09   | Emisión y consumo de códigos serializados                                                                                                               | 044        | `emitir_codigo_inscripcion` y `confirmar_codigo_inscripcion`                                                                 |
| 046 | F10   | Consentimiento versionado (aviso y términos)                                                                                                            | 045        | `aceptar_consentimiento_inscripcion`; la restauración puede abortar si perdería evidencia                                    |
| 047 | F11   | Guardado atómico de datos y representante                                                                                                               | 046        | `guardar_datos_inscripcion` y `datos_actualizados_at`                                                                        |
| 048 | F12   | Guardado atómico del certificado de estudios                                                                                                            | 047        | `guardar_certificado_inscripcion`                                                                                            |
| 049 | F13   | Envío y reenvío idempotentes                                                                                                                            | 048        | `enviar_solicitud_inscripcion`                                                                                               |
| 050 | F14   | Verificaciones del admin y listado con búsqueda escapada                                                                                                | 049        | RPC de verificación y listado; redefine `guard_solicitud_edit` (no la pise otra migración)                                   |
| 051 | F15   | Decisiones: devolver, rechazar y validar la aprobación                                                                                                  | 050        | RPC de decisión; bloqueo de correo por hash                                                                                  |
| 052 | F16   | Aprobación en dos pasos (reclamar y finalizar)                                                                                                          | 051        | RPC de aprobación; escribe `origen='solicitud'` y `requisitos_verificados_at`                                                |
| 053 | F20   | Vencimiento de devueltas y detección de huérfanos                                                                                                       | 052        | RPC de vencimiento y de retención                                                                                            |
| 054 | F19   | Confirmación atómica de identidad presencial                                                                                                            | 042 y 052  | RPC idempotente y auditada; marcas en la agenda del instructor                                                               |

Después de aplicar cada una: ejecutar su verificación, anotar la hora y no continuar si
alguna falla (usar su rollback). Pruebas manuales de red pendientes: el canal Realtime
privado (alumno e instructor autorizados, tercero rechazado), descrito en `inscripcion-043.md`.

## F45 · recorrido reproducible en PostgreSQL embebido

Ejecución local exclusiva del arnés F45: **001–054 aplicadas en orden, incluida003**.
No se conectó a Supabase, no se leyó .env y no se ejecutó el resto de la suite.
Comando: `npm run check:inscripcion-migrations`. El reporte JSON de cada ejecución se
escribe en `/tmp/inscripcion-f45.json` (configurable con MIGRATION_REPORT).

Antes de cada migración se toma un snapshot. Cada preflight existente se ejecuta
sobre una copia de ese estado; cada verificación y cada rollback, sobre copias
independientes posteriores a su migración. Un rollback nunca contamina la siguiente
etapa. Las verificaciones disponibles deben terminar literalmente en ROLLBACK.
Los scripts heredados compartidos018/019 se ensayan en ambas etapas.

| Migración | Preflight | Verificación | Rollback | Notas                                                                                                                                       |
| --------- | --------- | ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 001       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio; gen_random_uuid nativo; se omite solo CREATE EXTENSION pgcrypto en memoria |
| 002       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 003       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio; Seed original incluido, sin omitirlo                                       |
| 004       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 005       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 006       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 007       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 008       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 009       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 010       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 011       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 012       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 013       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 014       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 015       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 016       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 017       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 018       | OK        | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 019       | OK        | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 020       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 021       | N/D       | N/D          | N/D      | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 022       | N/D       | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 023       | N/D       | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 024       | N/D       | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 025       | OK        | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 026       | OK        | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 027       | OK        | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 028       | OK        | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 029       | OK        | N/D          | OK       | Aplicación OK; N/D: no existe script asociado en el repositorio                                                                             |
| 030       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 031       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 032       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 033       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 034       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 035       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 036       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 037       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 038       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 039       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 040       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 041       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 042       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 043       | OK        | OK           | OK       | Aplicación OK; btree_gist real; roles y ACL comprobados por la verificación                                                                 |
| 044       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 045       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 046       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 047       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 048       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 049       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 050       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 051       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 052       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |
| 053       | OK        | OK           | OK       | Aplicación OK; Preflight exige SELECT de service_role sobre storage.objects                                                                 |
| 054       | OK        | OK           | OK       | Aplicación OK                                                                                                                               |

Resultado: 54 aplicaciones, 32 preflights, 25 verificaciones y35 rollbacks correctos.
Todos los preflights, verificaciones y rollbacks
asociados que existen ejecutaron sin error. No se modificaron ni renumeraron042–054:
no apareció un fallo de sus scripts con las dependencias correctamente preparadas.
El primer pase detectó únicamente el permiso de lectura de storage.objects que
faltaba en la simulación; se añadió al bootstrap del arnés y se repitió todo.
No se añadió ese GRANT a una migración de dominio: el preflight053 sigue exigiéndolo.

### Límites del ensayo

PGlite usa btree_gist real y gen_random_uuid nativo; pgcrypto no está distribuida en
este arnés. Auth, Storage y Realtime usan la superficie local simulada que ya emplean
los helpers del repositorio, ampliada con storage.objects y sus permisos normales.
No sustituye la comprobación de configuración/permisos del proyecto real, la prueba
de suscripción Realtime ni una carrera multiconexión. OK significa ejecución de SQL
sin error; N/D no se presenta como una prueba pasada. No se inventaron scripts
faltantes de migraciones históricas aplicadas. Los bloqueos de rollback ante datos
reales y la compatibilidad de cada flujo requieren la fase final de pruebas/F23.

### Extensión F44-c (055)

055: aplicación, preflight, verificación y rollback OK en arnés F45
(`MIGRATIONS_THROUGH=055`, reporte `/tmp/inscripcion-f45-055.json`). El recorrido
001–055 completo terminó sin errores. Verifica lease exclusivo, token de cierre,
auditoría y ACL/RLS del ledger. No simula Auth real ni carreras multiconexión.
### Extensión F44-d (056)

056: aplicación, preflight, verificación y rollback OK en arnés F45.
Recorrido001–056:56 aplicaciones,34 preflights,27 verificaciones y37 rollbacks OK;
reporte `/tmp/inscripcion-f45-056.json`. Los scripts056 comprueban ACL/RLS, actor,
matrícula manual, ventana no vencida, override exitoso, idempotencia y certificado
original intacto usando fixtures que terminan en ROLLBACK. Ningún cambio a042–054.
055/056 no se aplicaron en Supabase; siguen pendientes de ejecución manual.
