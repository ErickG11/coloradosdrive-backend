# Operación C14 — Asistencia por bloque

Decisión: [ADR 024](../adr/024-asistencia-por-bloques.md). Evidencia: [aceptación](asistencia-c14-aceptacion.md).

## Base y aplicación manual

Se asumieron las migraciones aprobadas **001–087**, incluida la semilla local 003. No se asume C13 ni otra migración posterior. El borrador 064 y sus scripts permanecen excluidos. Antes de aplicar, confirmar con el dueño si la base real recibió alguna migración posterior a 087.

Aplicar a continuación en este orden. Cada verificación termina en **ROLLBACK**; ninguna activa indicadores. Guardar la salida de cada preflight.

| Orden | Preflight | Aplicar | Verificar | Inventario |
|---|---|---|---|---|
| 1 | [088](inscripcion-088-preflight.sql) | [088 contrato](../../migrations/088_contrato_asistencia.sql) | [088](inscripcion-088-verificacion.sql) | [Guardas 088](inscripcion-088-guardas.json) |
| 2 | [089](inscripcion-089-preflight.sql) | [089 bloques](../../migrations/089_asistencia_bloques.sql) | [089](inscripcion-089-verificacion.sql) | [Guardas 089](inscripcion-089-guardas.json) |
| 3 | [090](inscripcion-090-preflight.sql) | [090 reposición](../../migrations/090_reposicion_bloques.sql) | [090](inscripcion-090-verificacion.sql) | [Guardas 090](inscripcion-090-guardas.json) |
| 4 | [091](inscripcion-091-preflight.sql) | [091 avisos y compatibilidad](../../migrations/091_avisos_bloques.sql) | [091](inscripcion-091-verificacion.sql) | [Guardas 091](inscripcion-091-guardas.json) |

Las funciones se identifican con `md5(replace(prosrc,chr(13),''))`, calculado de la instalación local. Las guardas admiten únicamente los cuerpos de entrada y salida conocidos; las funciones nuevas también se protegen contra un cuerpo ajeno. No sustituir hashes para forzar una aplicación. Si una función ya fue modificada por una migración posterior, no reaplicar una anterior sobre ella: se rechaza la regresión.

La idempotencia se verificó reaplicando cada versión antes de avanzar a la siguiente. La reversión se comprobó en sentido 091 → 090 → 089 → 088 y después se reinstaló el lote. Aplicar la base de datos completa antes de publicar las versiones backend/frontend que consumen las nuevas RPC. Todas las migraciones terminan notificando la recarga de PostgREST; no requieren reiniciar servidores.

## Relleno y reversión

La 088 conserva una instantánea privada de los contratos nulos rellenados. Solo modifica `practice_plan`, además del versionado `updated_at` del mecanismo existente. No cambia objetivo, pagos, precios, cohortes ni fechas individuales.

Las consultas de verificación enumeran matrículas sin contrato demostrado, planes históricos fuera de una o dos horas y bloques fragmentados o con varios instructores. **No se deben inventar sus valores ni convertir automáticamente sus horarios.** En la reproducción S5 se rellenaron los tres contratos anteriores a 088 y no quedaron casos indeducibles; la base real no se consultó.

Rollback manual: [091](inscripcion-091-rollback.sql), [090](inscripcion-090-rollback.sql), [089](inscripcion-089-rollback.sql), [088](inscripcion-088-rollback.sql). Se verifican los hashes de salida antes de restaurar funciones. La reversión rechaza auditorías/avisos de bloque existentes y contratos rellenados modificados posteriormente: no borra operaciones reales para lograr un rollback. La 088 restaura únicamente los contratos de su instantánea que siguen intactos; no elimina los contratos de matrículas creadas después.

## Endpoints nuevos

Prefijo: `/practice-slots/blocks`. Todos pasan por autenticación; el identificador del actor se obtiene de `req.user`, nunca del cuerpo HTTP.

| Método y ruta | Rol | Función SQL |
|---|---|---|
| `GET /summary` | Estudiante | `student_practice_block_summary_v14` |
| `GET /options` | Estudiante | `student_practice_block_options_v14` |
| `GET /:enrollmentId/:date/cancel-preview` | Estudiante | `preview_practice_block_cancellation_v14` |
| `POST /:enrollmentId/:date/cancel` | Estudiante con requisitos verificados | `cancel_practice_block_with_reason_v14` |
| `POST /:enrollmentId/:date/confirm` | Estudiante con requisitos verificados | `confirm_practice_block_v14` |
| `POST /:enrollmentId/take` | Estudiante con requisitos verificados | `take_practice_block_v14` |
| `GET /admin-absences?studentId=UUID` | Administrador activo | `admin_practice_absences_v14` |
| `GET /instructor-groups?from=YYYY-MM-DD&to=YYYY-MM-DD` | Instructor activo | `instructor_practice_blocks_v14` |

`date` es una fecha civil de Ecuador. La consulta del instructor es inclusiva; la diferencia entre sus fechas no puede superar 31 días. El administrador puede omitir `studentId` para obtener los alumnos con faltas.

Cancelación: `{ "motivoCategoria": "trabajo", "motivoTexto": "No puedo asistir por trabajo" }`. Categorías: salud, trabajo, estudios, familiar, transporte y otro; texto recortado de al menos diez caracteres.

Toma: `{ "optionId": "identificador opaco de 32 caracteres hexadecimales" }`. No es una reserva ni una autorización: se vuelve a calcular la opción bajo bloqueo y con el alumno autenticado. Incluye el origen concreto para cambios y el pendiente concreto para reposiciones.

La vista previa devuelve bloque completo, resultado, usadas/restantes, inicio y efecto en español. No escribe. La lista incluye duración, instructor, origen, costo y pendiente. Prioridad: liberados; libres del instructor original; otros instructores para reposición únicamente cuando no hay alternativas del original. El cambio sin pendiente conserva libres del instructor del origen o cupos liberados, conforme a R4. El límite diario es por matrícula; la detección de solapes abarca todas las matrículas del alumno. El contador de `/summary` no depende de que `/options` encuentre cupos o responda correctamente.

Errores: entrada inválida 400; cuenta o matrícula ajena/inactiva 403; bloque iniciado, cupo consumido o disponibilidad cambiada 409. Los errores de bloqueo se traducen a 409. El segundo intento con una opción consumida recibe «Otro alumno tomó este cupo o ya no está disponible. Vuelve a consultar.»

Los endpoints anteriores por franja siguen disponibles. La pantalla C14 y sus reposiciones utilizan exclusivamente los nuevos endpoints por bloque.

## Escrituras y privilegios comprobados

Todas las funciones C14 son `SECURITY INVOKER`, con `search_path=''`. Se revoca ejecución a `public`, `anon` y `authenticated`, y se concede a `service_role`. La verificación 091 comprueba estas condiciones y los permisos de columna utilizados.

| Operación | Escrituras |
|---|---|
| Contrato | `NEW.practice_plan` en el disparador; relleno de contratos nulos demostrados en `enrollments` |
| Confirmación | `practice_slots.status`, `confirmed_at` para todas las horas |
| Cancelación | Contador de matrícula; una auditoría de bloque; alumno/estado/marcas de todas sus franjas; bandeja |
| Cambio | Liberación del origen; contador; una auditoría con destino; adjudicación o inserción de todas las horas de destino; bandeja |
| Reposición | Adjudicación completa; `repuesto_por_slot_id` y `repuesto_en`; bandeja; sin incrementar el contador |
| Cierre T−5 | Todas las horas liberadas a `sin_practica`; aviso único del bloque al instructor y correo pendiente |

Los GRANT de columna cubren inserción/actualización de notificaciones, inserción/adjudicación de franjas, contador/contrato de matrícula y campos nuevos/resolución de auditorías. Las funciones se ejecutaron como `service_role` en aceptación. Se inventariaron los disparadores existentes: no se elude la auditoría de asistencia, las protecciones de borrado ni la inmutabilidad de eventos. C14 no cambia `attended` al confirmar, cancelar o tomar.

## Matriz de avisos

| Evento | Destinatario | Tipo | Bandeja | Correo |
|---|---|---|---|---|
| Cancelación | Alumno | `resultado_cancelacion` | Sí, efecto y contador | No |
| Liberación por cancelación o cambio | Alumnos elegibles | `cupo_disponible` | Sí, agrupado por matrícula | No |
| Toma/reposición/cambio | Alumno | `cambio_realizado` | Sí | No |
| Cancelación/liberación/toma | Instructor afectado | `cambio_agenda_instructor` | Sí; actualiza estado y no leído | No |
| Tercera inasistencia | Todos los administradores activos | `falta_registrada_admin` | Sí, alumno/fecha/bloque | No |
| Cupo vacío a T−5 o cancelación tardía | Instructor | `sin_practica_instructor` | Sí | Sí, cola existente |
| Recordatorio T−20 | Alumno | `recordatorio_practica` | Sí | Sí, sin cambiar su regla |

Los avisos agrupados de cupos y las faltas administrativas no usan la identidad de una franja reutilizable como clave de deduplicación. Por eso el aviso sigue funcionando si el bloque vuelve a liberarse por otra persona. El instructor conserva un aviso actualizado de ese bloque, con el último estado, en lugar de mantener un texto de liberación obsoleto.

Realtime: `cohort-{id}-practice-slots` para invalidar disponibilidad; canales personales existentes y `user-{id}-notifications` para bandeja. La política del canal de avisos exige usuario activo y propietario del canal. Los payloads no transportan los datos de otros alumnos. La campana y la marca de cupos también se actualizan al enfocar la ventana.

El cron existente corre cada minuto cuando `DISABLE_CRON` no es `true`. La cola usa concesión de dos minutos, hasta tres intentos totales y siguiente intento un minuto después del fallo. Los tipos nuevos no entran en ella: `email_status` es NULL, también exigido por `notifications_blocks_inbox_only_v14`. No se efectuó ningún envío de correo durante las verificaciones locales.

## Interfaz y decisiones visibles

- El diálogo conserva el bloque, la vista previa y los errores dentro del mismo panel; no depende de un aviso general descartable.
- La reposición se abre directamente tras un resultado reprogramable; los cambios muestran el origen y el costo antes de confirmar.
- Asistencia y horas reservadas son cantidades distintas; el contador muestra cambios **usados**.
- El instructor ve bloques completos; los controles de identidad y asistencia física por hora se conservan dentro de ellos.
- El administrador dispone de chip de faltas, detalle por matrícula, bandeja y tarjeta «Faltas recientes». No se añaden filtros a Alumnos.
- CSS contempla 375, 768 y 1280 px, temas mediante tokens, reducción de movimiento y controles con teclado. Se revisó el código y se ejecutó TypeScript; no se hizo comprobación visual en navegador ni build.
