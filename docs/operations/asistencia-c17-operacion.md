# Operación C17 — Aviso de inasistencia en un solo paso

Decisión del dueño del 13/11/2026 (U1–U8), registrada en el [adendo del ADR 024](../adr/024-asistencia-por-bloques.md). Reemplaza el flujo de reposición «pendiente» de C14. Aplicación manual en el SQL Editor; no se aplica nada en la base real desde el repositorio.

## Orden de aplicación

Se asumen aplicadas la 001 a la 091.

| Orden | Preflight | Aplicar | Verificar (termina en ROLLBACK) | Rollback | Inventario de guardas |
|---|---|---|---|---|---|
| 1 | [092](inscripcion-092-preflight.sql) | [092 aviso en un paso](../../migrations/092_aviso_un_paso.sql) | [092](inscripcion-092-verificacion.sql) | [092](inscripcion-092-rollback.sql) | [Guardas 092](inscripcion-092-guardas.json) |

La 092 es idempotente y está protegida por hash `md5(replace(prosrc, chr(13), ''))`: exige los cuerpos de la 091 (o los propios de la 092 al reaplicarla) y termina con `NOTIFY pgrst, 'reload schema'`. El rollback restaura las dos funciones reemplazadas con su cuerpo de la 091, elimina las nuevas y la columna `accion`, y se niega si ya hay filas con `accion` (conservar la auditoría).

## Funciones

| Función | Tipo | Uso |
|---|---|---|
| `public.preview_practice_block_resolution_v17(alumno, matrícula, fecha)` | Nueva | Vista previa sin escritura: puede mover, horas libres, usadas/restantes, efecto de cada camino |
| `public.resolve_practice_block_v17(alumno, matrícula, fecha, acción, inicio, categoría, motivo)` | Nueva | Resolución atómica: `mover` o `falta` |
| `private.practice_day_options_v17(matrícula, fecha)` | Nueva | Horas libres del mismo instructor ese día (U2) |
| `private.practice_result_notice_v17`, `practice_day_label_v17`, `practice_range_label_v17` | Nuevas | Avisos de bandeja sin correo y textos en español |
| `private.practice_block_options_v14(matrícula, fecha)` | Reemplazada | Solo cupos liberados elegibles según U5 |
| `public.take_practice_block_v14(alumno, matrícula, opción)` | Reemplazada | Toma de un cupo liberado revalidada según U5/U6 |

Todas son `SECURITY INVOKER`, con `search_path` vacío, `REVOKE ALL` a `public, anon, authenticated` y `EXECUTE` solo para `service_role`. La verificación comprueba esto, los hashes y los privilegios de columna de `notifications`, `practice_slots`, `enrollments` y `practice_slot_cancellations`.

## Endpoints nuevos (`/practice-slots/blocks`, rol estudiante)

| Método y ruta | Función SQL |
|---|---|
| `GET /:enrollmentId/:date/resolution-preview` | `preview_practice_block_resolution_v17` |
| `POST /:enrollmentId/:date/resolve` — cuerpo `{ accion: "mover" \| "falta", inicio?: ISO, motivoCategoria, motivoTexto }`; requiere requisitos verificados | `resolve_practice_block_v17` |

`GET /summary`, `GET /options`, `POST /:enrollmentId/take`, `POST /:enrollmentId/:date/confirm` y `GET /admin-absences`, `GET /instructor-groups` se conservan. `cancel-preview` y `cancel` quedan por compatibilidad y la interfaz ya no los usa.

## Matriz de avisos

| Evento | Destinatario | Tipo | Correo |
|---|---|---|---|
| Cambio de hora | Alumno | `resultado_cancelacion` («Cambiamos tu bloque del … Usaste N de 2 reprogramaciones.») | No |
| Cambio de hora | Instructor | `cambio_agenda_instructor` («el alumno movió su bloque de X a Y») | No |
| Falta | Alumno | `resultado_cancelacion` (mensaje U3) | No |
| Falta | Instructor | `cambio_agenda_instructor` («el alumno no asistirá el bloque de X») | No |
| Falta | Administradores activos | `falta_registrada_admin` | No |
| Bloque liberado (cambio, falta o toma) | Solo alumnos elegibles (U5) | `cupo_disponible`, agrupado | No |
| Toma de un cupo | Alumno / instructor | `cambio_realizado` / `cambio_agenda_instructor` | No |
| Falta dentro de los últimos 5 minutos | Instructor | `sin_practica_instructor` | Sí, cola existente |
| Recordatorio T−20 | Alumno | `recordatorio_practica` | Sí, sin cambios |

## Evidencia local

Instalación 087 → 092 con PGlite (preflight, migración, verificación con ROLLBACK, rollback de prueba y reaplicación) y escenario T1–T12 con las funciones reales como `service_role`, en variantes de 2 y 1 hora por día. T11 (dos conexiones reales) queda **pendiente de ensayo con dos cuentas**: PGlite no ofrece dos sesiones. La exclusión la dan el candado global `pg_advisory_xact_lock(hashtextextended('student_schedule_write',0))` y los `FOR UPDATE` de cohorte, matrícula y franjas, y el segundo intento revalida y recibe CD409.
