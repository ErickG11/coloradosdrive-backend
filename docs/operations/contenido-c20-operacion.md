# Operación C20 — Materiales obligatorios previos al examen

Decisión del dueño del 13/11/2026 (V1–V6). Aplicación manual; se asumen aplicadas la 001 a la 093.

| Orden | Preflight | Aplicar | Verificar (ROLLBACK) | Rollback | Guardas |
|---|---|---|---|---|---|
| 1 | [094](inscripcion-094-preflight.sql) | [094 materiales previos](../../migrations/094_materiales_previos_examen.sql) | [094](inscripcion-094-verificacion.sql) | [094](inscripcion-094-rollback.sql) | [Guardas 094](inscripcion-094-guardas.json) |

Guardas de la base real (hashes vivos): `private.content_student` `e532f5a4…`, `private.start_exam_attempt` `22eac9bc…`, `content_start_attempt` `39a5723a…`, `content_student` público `0054e2ec…`, `private.resolve_item_access` `efd9ee91…`.

- **Abrir = completar (V1):** la acción `open` deja `completed_at = coalesce(existente, now())`.
- **La marca no se quita (V2):** `complete` con `completed=false` sobre un material completado devuelve `{error:'MARCA_NO_REVERSIBLE'}` (HTTP 409, «Un material completado no se puede volver a marcar como pendiente.») y no escribe nada. Si el material no estaba completado, no hace nada. Reabrir el material siempre es posible.
- **Requisito (V3):** `private.exam_prerequisites_v20(alumno, elemento)` (SECURITY INVOKER) devuelve los materiales obligatorios y publicados, anteriores al examen en la misma materia, aún no completados y cuyo acceso para el alumno es `abierto`. Lo usan el catálogo (`bloqueado` y `prerequisitos_pendientes` en cada examen) y `start_exam_attempt` (error `MATERIALES_PENDIENTES`, HTTP 409, con `detalles.pendientes`), después de comprobar el acceso y antes de contar intentos.
- **V4/V5:** el intento en curso se devuelve antes de la comprobación; un examen aprobado o con intento en curso se lista sin requisitos pendientes.
