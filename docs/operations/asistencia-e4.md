# Asistencia E4: registro, correcciones e historial

Backend en `feat/asistencia-e3-e4`, sobre E3 (`2513743`). **034_asistencia_auditoria.sql** es el siguiente numero libre: se revisaron `migrations/` y `docs/operations/`, incluido el borrador de Cohortes 030. Aplicacion manual en el SQL Editor; esta entrega no aplica SQL remoto.

## Reglas y persistencia

`practice_slots.attended` sigue siendo la fuente del valor actual. `practice_attendance_events` conserva instantaneas de franja, alumno, instructor, cohorte, horario, duracion, actor, rol del actor al escribir, fecha, tipo `registro|correccion`, valor anterior, nuevo y motivo. No se inventa auditoria para los valores anteriores a 034: se conservan y pueden corregirse, registrando su valor real anterior.

La tabla tiene RLS activa, sin politicas ni grants a `anon`/`authenticated`; `service_role` tiene SELECT/INSERT, nunca UPDATE/DELETE/TRUNCATE. Un trigger tambien rechaza UPDATE/DELETE de eventos. Los identificadores son instantaneas sin FK/cascadas a cuentas o franjas, como el historial E1: una eliminacion definitiva no borra ni bloquea esta auditoria. No se copian nombres, correos ni documentos a los eventos. `transaction_id` es un dato interno, excluido de la API.

Las RPC `register_practice_attendance` y `correct_practice_attendance` son `SECURITY INVOKER`, con `search_path` vacio y EXECUTE solo para el backend. El actor siempre procede de `req.user.id`; su rol y estado activo se verifican tambien en `public.users`. Se bloquea primero el alumno y despues la franja, revalidando propietario y reloj despues de obtener los locks. Un cambio de asistencia por UPDATE directo sin evento de la misma transaccion se rechaza; un INSERT con asistencia ya asignada tambien. Las acciones E1/E2 que conservan `attended=NULL` siguen funcionando.

- Registro inicial: instructor propietario, practica `completado`, bloque ya terminado y `attended=NULL`; no pide motivo. No existe limite de 48 horas para este primer registro. Admin usa la correccion administrativa si debe resolver una completada sin registrar.
- Correccion: motivo recortado de 10 a 500 caracteres y valor distinto del actual. Instructor solo en sus franjas y hasta el fin del bloque + 48 horas, inclusive; admin en cualquier completada y sin limite temporal. Instructor no usa correccion para un valor NULL.
- El cambio, el evento y el aviso se guardan en una sola transaccion. Si falla cualquiera, ninguno persiste. Repetir un registro falla con 409; repetir una correccion que ya dejo ese mismo valor falla con 409.
- Cada correccion crea `asistencia_corregida` en la bandeja del alumno, tambien si esta desactivado. Solo bandeja: `emailStatus=null`, sin SMTP. `attendanceEventId` y un indice unico `(user_id, attendance_event_id)` deduplican el mismo evento. Varias correcciones de una misma franja generan avisos distintos. Se preserva la unicidad anterior de los tipos E3; se ajusta el predicado de su helper `ON CONFLICT` junto con el indice.
- `falta` sigue siendo exclusivamente un resultado de cancelacion E1/033. No se convierte en `attended=false`, no crea derecho a reposicion y no suma horas asistidas.

## Contrato HTTP

Todas las rutas requieren `Authorization: Bearer <JWT>`, cuenta activa y permisos de rol. El alumno debe haber cambiado su contrasena temporal. Nunca se acepta actor, rol o alumno del body/query para decidir propiedad. Los campos adicionales no autorizan otra identidad. Fechas ISO 8601; el frontend debe presentarlas con los helpers de `America/Guayaquil`.

### Instructor: registro y correccion

`PATCH /practice-slots/:id/attendance`

- Registro: `{ "attended": true }` (tambien `false`). Se conserva la ruta y la respuesta que usa el frontend actual.
- Correccion: `{ "attended": false, "motivo": "Se verifico que el alumno no asistio" }`.
- `attended` debe ser un boolean JSON, no una cadena. La presencia de `motivo` selecciona correccion; un motivo vacio, NULL o invalido da 400 y nunca se convierte en registro inicial.
- 200: `PracticeSlot` con `{id, cohortId, instructorId, studentId, scheduledAt, durationMinutes, status, confirmationNotifiedAt, releaseNotifiedAt, confirmedAt, attended, createdAt, updatedAt}`. Valores de estado y campos identicos a E3.
- Una correccion del frontend anterior, que solo manda `attended`, recibe 409 `ATTENDANCE_ALREADY_REGISTERED` y un mensaje que pide motivo. La interfaz E4 debe agregar ese campo; el registro inicial continua compatible.

### Admin: correccion

`PATCH /practice-slots/:id/attendance/correction`

Body obligatorio `{ "attended": true, "motivo": "Asistencia verificada con el instructor" }`. Solo admin; admite corregir `NULL` de una practica completada, con evento de tipo `correccion`, motivo y aviso al alumno. Respuesta 200 `PracticeSlot`, igual que arriba. No permite registrar asistencia de practicas futuras ni no completadas.

### Admin: eventos de una franja

`GET /practice-slots/:id/attendance/events?page=1&pageSize=20`

200 `{items, page, pageSize, total}`. Cada item:

```json
{
  "id": "UUID del evento",
  "practiceSlotId": "UUID de franja",
  "studentId": "UUID de alumno",
  "instructorId": "UUID de instructor de la practica",
  "cohortId": "UUID de cohorte",
  "scheduledAt": "2026-10-25T15:00:00+00:00",
  "durationMinutes": 60,
  "actorId": "UUID del actor",
  "actorRole": "instructor",
  "createdAt": "2026-10-26T12:00:00+00:00",
  "tipo": "correccion",
  "previousAttended": true,
  "newAttended": false,
  "motivo": "Se reviso el registro original"
}
```

`actorRole`: `instructor|admin`. `tipo`: `registro|correccion`. `previousAttended`: boolean o NULL; `newAttended`: boolean. `motivo`: NULL en registro y texto en correccion. Orden descendente por `createdAt,id`. Franja existente sin eventos: lista vacia; franja eliminada con eventos: conserva la auditoria; ninguna de las dos: 404.

### Alumno: matriculas para elegir historial

`GET /estudiantes/practice-history/enrollments`

200 array de `{enrollmentId, cohortId, courseId, courseType, status, horasObjetivo}` del propio alumno. Incluye matriculas activas, pendientes de cohorte, finalizadas y retiradas, de mas reciente a mas antigua. `cohortId` y `horasObjetivo` pueden ser NULL. `courseType`: `A|B`; `status`: `activo|pendiente_cohorte|finalizado|retirado`. No se modifica el contrato de `/estudiantes/enrollments`.

### Alumno: historial y horas por matricula

`GET /estudiantes/practice-history?enrollmentId=<UUID>&page=1&pageSize=20`

`enrollmentId` es obligatorio y debe ser propio, incluso si la matricula esta finalizada/retirada. 200:

```json
{
  "enrollmentId": "UUID de matricula",
  "page": 1,
  "pageSize": 20,
  "total": 4,
  "items": [
    {
      "id": "practice:UUID o cancellation:UUID o recovery:UUID",
      "practiceSlotId": "UUID de franja",
      "cancellationId": null,
      "scheduledAt": "2026-10-25T15:00:00+00:00",
      "durationMinutes": 60,
      "slotStatus": "completado",
      "attended": true,
      "estado": "asistio",
      "resultado": null,
      "motivo": null
    }
  ],
  "summary": { "horasAsistidas": 2, "horasObjetivo": 10, "horasPerdidas": 1 }
}
```

`id` identifica la fila historica y debe usarse como key: una franja puede aparecer como cancelacion de un alumno y como practica de otro. `slotStatus` es el estado actual solo para una practica aun asignada al alumno; es NULL en instantaneas. `cancellationId` y `resultado` son NULL salvo cancelacion. No se devuelve informacion del alumno que haya tomado una franja liberada.

Los seis valores de `estado` se presentan asi:

- `asistio`: completada, `attended=true`.
- `no_asistio`: completada, `attended=false`.
- `pendiente`: asignada/confirmada o completada con asistencia sin registrar. `slotStatus` distingue estas situaciones. No presume asistencia real por silencio ni por completar el bloque.
- `liberada`: cancelacion reprogramable aun sin reposicion o reserva antigua liberada por desactivacion.
- `falta`: cancelacion con resultado `falta`; `attended` sigue NULL.
- `cancelada`: `hora_perdida`, cambio de cupo o cancelacion cuya reposicion ya se uso. `resultado` conserva la consecuencia E1.

El resumen se calcula sobre todo el historial, independientemente de la pagina. `horasAsistidas` suma minutos solo de `completado AND attended=true`, como `studentGraduation.ts`. `horasObjetivo` usa `enrollments.horas_practica_objetivo` y puede ser NULL; no se inventa un objetivo. `horasPerdidas` suma las completadas con `attended=false` y las cancelaciones definitivas `hora_perdida|falta`; las reprogramables no suman. Cancelaciones E1 son bloques de 60 minutos. Las reservas antiguas por recuperacion carecen de duracion conocida: `durationMinutes=NULL`, sin credito ni perdida inferidos. Una correccion actualiza el resumen al consultar de nuevo; nunca reduce el objetivo para certificar.

La relacion disponible para practicas actuales es `student_id + cohort_id`, igual que el calculo existente de graduacion: `practice_slots` no tiene `enrollment_id`. Si hay varias matriculas del mismo alumno en la misma cohorte, se devuelve 409 `PRACTICE_CONFLICT` para impedir doble atribucion; el preflight las identifica. No se reasignan ni corrigen datos ambiguos automaticamente. Las cancelaciones conservan su matricula exacta y su instantanea de horario.

Paginacion en ambos GET paginados: `page` 1..1000000, `pageSize` 1..100, valores unicos, defaults 1/20. Orden historico descendente por `scheduledAt,id`. Una pagina posterior al final devuelve `items:[]` con total/resumen completos. La paginacion por offset puede cambiar entre consultas si entran nuevos datos; no representa una instantanea entre requests.

### Errores y ampliacion de notificaciones

400 de validacion: `{status:"error", message, code:"INVALID_FIELD", field}`; UUID/paginacion, boolean o motivo invalidos. 401 sin sesion; 403 rol/cuenta no permitidos. Otros errores de reglas conservan `message` y un `code` estable:

- `PRACTICE_NOT_FOUND` (404, SQL AT404): franja inexistente o ajena al instructor.
- `ATTENDANCE_FORBIDDEN` (403, AT403): rol o cuenta sin permiso.
- `ATTENDANCE_WINDOW_CLOSED` (409, AT410): instructor fuera de 48 horas.
- `ATTENDANCE_SAME_VALUE` (409, AT411): correccion sin cambio.
- `INVALID_FIELD`, `field:"motivo"` (400, AT412): motivo invalido tambien al llamar la RPC directamente.
- `PRACTICE_NOT_COMPLETED` (409, AT413): estado o fin de bloque no permiten registrar.
- `ATTENDANCE_ALREADY_REGISTERED` (409, AT414): se requiere correccion con motivo.
- `ATTENDANCE_NOT_REGISTERED` (409, AT415): instructor intento corregir NULL.
- `ATTENDANCE_AUDIT_REQUIRED` (409, AT417): escritura directa sin evento.
- `ENROLLMENT_NOT_FOUND` (404, CD404): matricula inexistente o ajena.
- `PRACTICE_CONFLICT` (409, CD409): atribucion ambigua o practica modificada.

Contencion/locks usa el 409 existente de practicas. Un fallo inesperado aborta la transaccion y devuelve 500; no se realiza una escritura REST ni un aviso fuera de la RPC como alternativa.

`GET /notifications` y PATCH de lectura mantienen sus contratos E3, con un campo adicional `attendanceEventId: UUID|null` en cada item. Nuevo `tipo:"asistencia_corregida"`, `practiceSlotId` apunta a la practica, `scheduledAt` es instantanea y `emailStatus=null`. La campana E3 usa titulo/mensaje del servidor y puede mostrarlo sin Realtime.

## Aplicacion, verificaciones y limites

1. Revisar y ejecutar `asistencia-e4-preflight.sql` en modo lectura: comprobar 033, helper/indice y registros previos/ambiguos. Resolver inconsistencias con decision explicita antes de aplicar; no modificar automaticamente historiales.
2. Coordinar una pausa de registro/correccion de asistencia. Aplicar 034 y desplegar este backend antes de reabrir esas acciones: E3/main usa UPDATE directo y el nuevo trigger lo rechaza. E4 requiere las RPC nuevas. Cancelacion/cambio, scheduler T-20/T-5 y cola E3 siguen sus reglas anteriores; no hay envios nuevos de correo por E4.
3. Ejecutar ENTERO `asistencia-e4-verificacion.sql`, incluido su ROLLBACK final. Solo fixtures nuevos; no SMTP/Broadcast. Probar luego las rutas con cuentas de prueba y preparar la interfaz E4 con motivo obligatorio.
4. Rollback: detener E4 antes de ejecutar `asistencia-e4-rollback.sql`. Solo retira 034 cuando no existe ningun evento/aviso E4; si ya hay historial aborta y exige correccion de avance. No elimina auditoria usada ni restaura valores de asistencia.

Validacion local: `DISABLE_CRON=true npm run test:practice-attendance-db` usa PGlite sin .env ni red; ensaya aplicacion/reversion, ACL/RLS, ventana, propiedad/roles, motivos, mismo valor, aviso unico por evento y atomicidad ante fallo de bandeja. Tambien ejecuta la verificacion E3 sobre 034. Jest cubre contratos y permisos HTTP con Supabase mockeado, ademas de servicios, graduacion y scheduler. Ejecutar typecheck, build y lint. PGlite usa una conexion: no demuestra bloqueos simultaneos reales entre instancias.

El conector denego la lectura del historial remoto de Supabase. No se verificaron 033/034 aplicadas, datos remotos, Railway ni integracion de frontend/backend real. No se aplicaron migraciones remotas. Fuera: interfaz E4, certificacion/emision de certificados, edicion de cancelaciones, purga de auditoria, notificacion por correo de correcciones y reconstruccion de autores/fechas de asistencias anteriores a 034.

Resultado local: typecheck, build y lint correctos; suite completa con `CI=true` de 991 pruebas en 60 suites. Pasaron los ensayos PostgreSQL aislados de asistencia E4/E3 y el de Estudiantes usado en CI. Permanece el aviso preexistente TS151002 de ts-jest, sin fallos de pruebas. El workflow de GitHub incorpora el ensayo de 034 como paso obligatorio.
