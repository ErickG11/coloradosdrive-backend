# RF-04 A: persistencia de calificaciones

Entrega SQL sobre `main` actualizado (`02524e0`), rama `feat/rf04-calificacion-instructores`.
La cadena real del repositorio termina en **034**; se agrega **035_calificacion_instructores.sql**.
No se aplican migraciones remotas. Backend HTTP y frontend se entregaran despues.

## Que guarda cada pieza

| Pieza                                   | Proposito                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private.practice_rating_rollout`       | Una unica fila con el corte `enabled_at`, fijado al final de 035. No cambiar en produccion.                                                                                            |
| `practice_slots.rating_window_opens_at` | Inicio exacto de las 24 horas; no depende del cron, del momento de consultar ni de `updated_at`.                                                                                       |
| `practice_ratings`                      | Una respuesta por practica: entero 1..5, comentario opcional de hasta 1000 caracteres despues de recortar espacios, fecha y campos de anulacion. Comentario vacio se guarda como NULL. |
| Triggers y RPC de envio                 | Revalidan propietario, cuenta activa, eliminacion pendiente, estado, asistencia, corte, ventana y unicidad bajo locks. Protegen tambien escrituras directas con `service_role`.        |
| `encuesta_practica`                     | Aviso solo en bandeja, guardado con la asistencia y la ventana en la misma transaccion.                                                                                                |
| RPC del admin                           | Promedio y cantidad de respuestas vigentes, ranking y detalle sin identificadores del alumno.                                                                                          |

Las tablas nuevas tienen RLS habilitada, sin politicas ni grants para `PUBLIC`, `anon` o `authenticated`.
Solo `service_role` tiene los permisos necesarios; todas las funciones son `SECURITY INVOKER`, con `search_path` vacio y EXECUTE reservado al backend.
El alumno y el instructor autenticados no tienen acceso SQL directo, aunque conozcan IDs. Las RPC administrativas verifican ademas el rol admin activo del actor recibido del backend.
Patron de permisos: 033/034 y [documentacion oficial de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Ventana y corte historico

034 ya registra `practice_attendance_events.created_at` usando `v_now`, tomado despues de bloquear la franja.
035 conserva ese mismo reloj y guarda:

```text
fin = scheduled_at + duration_minutes
inicio = max(fin + 5 minutos, created_at del evento que puso attended=true)
abierta = inicio <= reloj de PostgreSQL < inicio + 24 horas
elegible por corte = fin > private.practice_rating_rollout.enabled_at
```

El registro inicial tardio abre desde su evento. Una correccion posterior a `true` reinicia desde el nuevo evento, respetando siempre `fin+5`.
No se usa `updated_at`: tambien cambia por otras operaciones. Guardar el inicio evita reconstruir el ultimo evento por fecha/UUID y no inventa fechas para asistencias antiguas sin auditoria.
El registro inicial de asistencia sigue sin limite temporal; el instructor conserva sus 48h para corregir y el admin su correccion sin limite.

El corte es una fila privada insertada una sola vez con `clock_timestamp()` al final de la instalacion, inmediatamente antes de COMMIT.
035 bloquea escrituras de franjas durante la instalacion. Solo se habilitan encuestas cuando **el fin es estrictamente posterior al corte**; igualdad queda excluida.
No se hace backfill: las practicas anteriores conservan sus datos y no generan ventanas ni avisos, ni siquiera si luego se corrige su asistencia.
El backend no puede editar el corte. Se puede consultar despues con `select * from private.practice_rating_rollout;` como propietario del SQL Editor.

Una correccion de `true` a `false` cierra la ventana y establece `invalidated_at`, `invalidation_reason` e `invalidation_event_id` en la respuesta, usando fecha/motivo del evento auditado de la misma transaccion.
La fila permanece y su UNIQUE tambien. Volver a `true` **no restaura la respuesta ni permite otra encuesta**. Promedio, cantidad y detalle excluyen anuladas.
Si no hubo respuesta, una correccion posterior a `true` puede abrir una nueva ventana, segun la decision aprobada.
Desactivar al alumno no pausa el reloj; solo una cuenta activa puede enviar.

## Funciones existentes: firmas y diff minimo

Se verificaron las firmas antes de preparar los reemplazos. No se editan 026, 030, 033 ni 034; los reemplazos estan en 035.
El preflight y la migracion comparan los cuerpos desplegados con los del repo mediante hashes MD5, normalizando CRLF/LF. Es una comprobacion de igualdad, no un mecanismo de seguridad criptografica.

| Funcion                                                                                                                                                                  | Version real anterior                                | Cambio                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private.write_practice_attendance(p_slot uuid, p_actor uuid, p_attended boolean, p_correction boolean, p_motivo text default null) returns setof public.practice_slots` | 034, funcion en linea 120; UPDATE en linea 160       | Agrega `v_rating_cut`; amplia ese UPDATE para guardar/cerrar la ventana. Antes del aviso E4 existente, anula la respuesta si se corrige a false y encola el aviso de encuesta si corresponde. Conserva validaciones, locks, reloj, evento, aviso E4 y retorno.              |
| `public.delete_student_data(p_actor uuid, p_student uuid, p_version timestamptz, p_cleaned_paths text[]) returns jsonb`                                                  | Version vigente **030**, linea 298; originada en 026 | Despues del lock de franjas y antes de `v_cut:=clock_timestamp()` (linea 328 anterior), agrega solo `delete from public.practice_ratings where student_id=p_student;`. Conserva CAS, fases, controles de Storage/payments, limpieza previa y liberacion de franjas futuras. |

Los wrappers `register_practice_attendance` y `correct_practice_attendance` no cambian.
`private.assert_student_not_deleting(uuid)` y `private.guard_student_deletion_write()` tampoco cambian; el guard existente se agrega como trigger BEFORE INSERT de calificaciones.
Las FKs de alumno/franja usan RESTRICT: la limpieza explicita ocurre antes del borrado de ambos. Las respuestas solo pueden borrarse dentro de una eliminacion D en fase Storage con el alumno bloqueado.
Una anulacion solo puede escribirse una vez, ligada a una correccion `true -> false` de la misma transaccion; score y comentario son inmutables.

## Contratos SQL para las piezas siguientes

Los UUID de actor/alumno deben proceder del JWT validado en el backend futuro, nunca de un body que decida identidad.

| RPC                                                                                                                         | Resultado                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit_practice_rating(p_slot uuid, p_student uuid, p_score numeric, p_comment text default null)`                         | JSON `{id, practiceSlotId, score, comment, createdAt}`. Se usa parametro numeric para rechazar decimales antes de convertir al smallint almacenado.                                             |
| `list_student_pending_practice_ratings(p_student uuid, p_page integer default 1, p_page_size integer default 20)`           | `{items:[{practiceSlotId,instructorName,scheduledAt,opensAt,closesAt}],total,page,pageSize}`. Solo ventanas abiertas sin respuesta.                                                             |
| `list_admin_instructor_ratings(p_actor uuid, p_page integer default 1, p_page_size integer default 20)`                     | `{items:[{instructorId,instructorName,active,average,responses,rankingEligible,label}],total,page,pageSize}`. Incluye instructores activos e inactivos.                                         |
| `admin_instructor_rating_detail(p_actor uuid, p_instructor uuid, p_page integer default 1, p_page_size integer default 20)` | `{instructorId,average,responses,rankingEligible,label,items:[{score,comment}],total,page,pageSize}`. No devuelve alumno, ID de respuesta/franja/cohorte ni fechas para cruzarlas con horarios. |

Paginacion: page 1..1000000 y pageSize 1..100, valores no NULL. Paginas fuera del final conservan total y resumen con `items:[]`.
Promedio aritmetico por respuesta, redondeado a dos decimales para mostrar; el orden usa el promedio sin redondear.
Orden: elegibles (`responses>=3`) primero; despues promedio descendente, cantidad descendente, nombre e ID del instructor.
Siempre se informa cantidad/promedio: con 1 o 2 respuestas `rankingEligible=false` y `label="pocas calificaciones"`; con 0, promedio NULL y cantidad 0.
El detalle se ordena internamente por fecha/ID descendente, sin devolver esas claves. El comentario es texto libre: la interfaz debera pedir al alumno que no incluya datos personales; no se promete anonimato del texto que el propio alumno escriba.

| SQLSTATE          | HTTP/codigo a mapear en backend                                                            |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `RT403`           | 403 `RATING_FORBIDDEN`                                                                     |
| `RT404`           | 404 `PRACTICE_NOT_FOUND` en envio; `INSTRUCTOR_NOT_FOUND` en detalle                       |
| `RT409`           | 409 `RATING_ALREADY_SUBMITTED`, tambien si la respuesta ya fue anulada o vencio su ventana |
| `RT410`           | 409 `RATING_WINDOW_CLOSED`                                                                 |
| `RT412`           | 409 `RATING_NOT_ELIGIBLE`: no completada, no asistida, previa al corte o aun no abierta    |
| `22023` / `23514` | 400 `INVALID_FIELD` para entrada/constraint invalida                                       |
| `CD030`           | 409 de eliminacion pendiente, conservando el contrato D                                    |
| `55P03` / `40P01` | 409 de contencion/conflicto, siguiendo el manejo existente de practicas                    |

Dos pestañas se serializan bloqueando alumno -> franja -> respuesta; la segunda revalida despues de esperar.
El UNIQUE fisico por practica impide duplicados incluso ante otros escritores; la RPC traduce `unique_violation` a `RT409`.
No se realizan UPDATE REST ni avisos fuera de la transaccion como alternativa a una RPC fallida.

El aviso `encuesta_practica` reutiliza `private.enqueue_practice_notification` de 034 sin modificarlo: una notificacion por `(user_id,tipo,practice_slot_id)`, sin correo ni attendance_event_id.
Puede crearse antes de que pasen los cinco minutos; el titulo no afirma que ya este abierta y el cliente futuro consultara el plazo real.
Una correccion a true no duplica ese aviso. E4 sigue creando su propio aviso de correccion por evento.
El helper conserva su regla previa de destinatarios activos; un alumno inactivo no recibe este nuevo aviso. Leer un aviso no autoriza a enviar una encuesta vencida/anulada.

## Aplicacion manual y comprobaciones

1. Revisar [rf04-a-preflight.sql](rf04-a-preflight.sql) y ejecutarlo ENTERO en SQL Editor. Verifica tablas/columnas/tipos, firmas, cuerpos y trigger de auditoria; muestra ACL, constraints e indices. Si hay drift, detenerse y comparar las definiciones, sin cambiar hashes para forzar la aplicacion.
2. Confirmar 030..034 aplicadas y que no existe otra 035. El historial administrado de Supabase, si existe, puede no incluir aplicaciones manuales: comparar tambien con los SQL ejecutados. Verificar que los permisos mostrados sean verdaderos y revisar las inconsistencias listadas.
3. Coordinar una pausa breve de escrituras de asistencia/eliminacion mientras se aplica [035](../../migrations/035_calificacion_instructores.sql) y se verifica. El lock tiene timeout de 5s; si falla, toda la instalacion se revierte. No cambiar el corte ni poblar ventanas a mano.
4. Ejecutar ENTERO [rf04-a-verificacion.sql](rf04-a-verificacion.sql), incluido su ROLLBACK. Requiere el propietario del SQL Editor para fixtures, cambios de rol y triggers temporales de prueba. El script mueve el corte a una fecha de fixture **solo dentro de la transaccion**, y lo restaura al finalizar. No ejecutar secciones sueltas ni sustituir ROLLBACK por COMMIT.
5. Confirmar que `practice_ratings` sigue vacia tras el ensayo y que `enabled_at` conserva la fecha real de instalacion. No se necesita ni se usa el conector Supabase para DELETE: la verificacion completa corre en SQL Editor.

La verificacion cubre envio valido, doble envio/UNIQUE, propietario/roles/cuenta, NULL/false, fracciones/rango/comentario, fin+5, vencimiento, corte incluido su igualdad, correccion tardia a true, anulacion irreversible, promedio/minimo/orden, detalle sin identificadores, atomicidad ante fallo de bandeja/anulacion, ACL/RLS, eliminacion completa y preservacion de auditoria E4.

Ensayo reproducible local, sin .env ni red: `node tests/database/practiceRatings.mjs`.
Aplica la cadena 001..034 en PGlite, ejecuta el preflight, instalacion y retirada, verifica restauracion de funciones previas y corre el SQL de verificacion.
Tambien ejecuta los scripts de regresion E3/E4 sobre 035 y comprueba que un rollback usado aborte.
PGlite usa una sola sesion: prueba las reglas e idempotencia, pero **no demuestra carreras reales entre conexiones PostgreSQL simultaneas**.

## Retirada completa

[rf04-a-rollback.sql](rf04-a-rollback.sql) restaura los cuerpos originales de 034 y 030; retira las RPC/triggers/tablas/columna/indices y el tipo de aviso RF-04, sin CASCADE y conservando E3/E4.
Solo procede antes de que existan respuestas, avisos RF-04 o ventanas. Si ya se uso RF-04, aborta para no perder informacion; se necesita una correccion de avance.
Pausar las acciones que escriben asistencia/eliminacion mientras se ejecuta el script completo en SQL Editor.
No se borra auditoria de asistencia ni se revierten valores de `attended`.
