# B: acceso y reservas de alumnos

Implementación para revisión en feat/estudiantes-desactivar-reactivar. No aplicada
en Supabase. D no se implementa en esta entrega. Ticket sugerido: «Backend:
desactivar/reactivar estudiantes, bloquear acceso y recuperar reservas».

## Contrato

Admin autenticado: POST /admin/estudiantes/:id/desactivar y /reactivar, sin cuerpo
requerido. Respuesta: id, activo, reservas [{slotId,status,reason}],
recuperacionPendiente. Las reservas restauradas quedan asignadas y requieren
confirmación de nuevo; no se restaura a ciegas el estado confirmado anterior.
GET /admin/estudiantes/:id/reservas-pendientes lista los registros cancelados por
desactivación y pendientes de reprogramar, con motivo y referencia de horario.
No hay endpoint nuevo para alumnos ni frontend en B.

## Acceso y errores parciales

Desactivar: comprobar que es estudiante, transacción de activo=false/liberación/
auditoría, después ban de Auth (misma duración que instructores). Reactivar:
retirar ban, confirmar activo=true/auditoría, después recuperar una por una.
No consultar correo ni enviar avisos por Gmail. No cambiar matrícula, cupo,
abono, asistencia pasada ni prácticas ya iniciadas.

Middleware consulta perfil/activo/rol en cada petición de estudiante, incluso
account-status y cambiar-password. Esas excepciones solo evitan el bloqueo por
contraseña temporal, no el de cuenta. Sin perfil/inactivo: 403 ACCOUNT_INACTIVE;
error consultando el estado: 503. No depende de que caduque el JWT para bloquear HTTP.

Auth y SQL no comparten transacción. Fallo de ban/unban/SQL: 503 UNCONFIRMED y
revisión/reintento de la misma acción; no dar éxito completo si Auth falló. Una
desactivación cuyo ban falla conserva activo=false y las reservas liberadas;
una reactivación cuyo UPDATE falla mantiene el perfil cerrado aunque Auth se
haya desbaneado. Acciones admin opuestas concurrentes o fallos de red pueden
requerir reconciliar Auth/activo; no se añade orquestador ni transacción global.
En cambio, un conflicto o error de recuperación de reservas nunca revierte una
reactivación confirmada: devuelve pendientes/motivo o recuperacionPendiente=true
si hubo resultado de recuperación no confirmado. Repetir /reactivar permite retomarla.

## SQL propuesto y justificación

SQL exacto: migrations/025_estudiantes_acceso.sql.

- student_access_audit: IDs del actor/alumno, acción y fecha; sin FK al perfil,
  ni valores personales. Solo INSERT/SELECT backend; RLS y sin acceso público.
- student_practice_recovery: necesario para recordar de quién era una reserva
  tras poner student_id=NULL en el inventario. IDs/horario/estado/motivo, PK por
  alumno/franja y FK CASCADE al alumno para que D pueda limpiar esa recuperación.
  Sin FK a la franja: si se elimina, queda visible franja_eliminada para reprogramar.
- set_student_active: lock de alumno y franjas, libera solo futuras asignadas/
  confirmadas; guarda cancelada_por_desactivacion. Idempotencia: repeticiones no
  duplican auditoría si activo no cambia ni crean dos registros de recuperación.
- restore_student_practice: solo registros de desactivación, independiente por
  franja. Revalida futuro, identidad de franja, libre/instructor activo, duración
  y ausencia de solapamientos. Reutiliza la reserva existente trasladada al
  esquema privado, con wrapper público que exige alumno activo bajo lock.
  Ocupada, pasada, instructor no disponible, matrícula no vigente, ventana
  cerrada o solapamiento quedan pendiente_reprogramar con motivo. Las cancelaciones
  manuales sin registro no se recuperan. Repetir una recuperación ya confirmada
  no duplica ni vuelve a reservar una práctica que después se canceló a mano.
- Exclusión GiST por alumno y rango [inicio,fin), incluso entre A/B, con 60 minutos
  y lock_timeout=5s. Aborta con registros incompatibles, sin corregirlos automáticamente.

No se agregan dependencias, servicios, procesos periódicos ni variables de entorno.

## Realtime y recordatorios

RLS de canales personales/cohorte comprueba perfil activo en la base. No se emiten
avisos personales a perfiles inactivos/ausentes. Scheduler no envía correo a
destinatarios inactivos. Broadcast de cohorte solo lleva {}, manteniendo el evento
slot-released que el frontend usa para volver a consultar la API.

Límite aceptado: canales ya abiertos pueden recibir señales vacías hasta que expire
el JWT; sin datos expuestos. No hay rotación de canales ni cambios de frontend.
Las políticas se recalculan al conectar/renovar token, no en cada mensaje:
https://supabase.com/docs/guides/realtime/authorization#updating-rls-policies

## Verificación aislada y despliegue pendiente

DISABLE_CRON=true npm run test:student-access-db ejecuta el SQL completo con
COMMIT final sustituido por ROLLBACK y comprueba ausencia de tablas/funciones
nuevas; después instala en la base ficticia y prueba reservas, auditoría y RLS.
Usa PostgreSQL 18.6 (PGlite 0.5.10, btree_gist incluido). El proyecto real es
PostgreSQL 17.6; no equivale a un dry-run allí. No carga .env ni usa red/datos reales.

Resultado local de esta entrega: build y lint correctos; Jest, 43 suites y 584
pruebas correctas; ensayo SQL BEGIN/ROLLBACK correcto. Incluye pruebas de bloqueo
en rutas excepcionales, no enviar correo a inactivos, payload de cohorte vacío,
liberación sin perder asistencia pasada, recuperación idempotente y conflictos
que no revierten la reactivación. Los errores SQL/red inciertos devuelven 503
UNCONFIRMED con log de IDs y estado, sin valores del perfil.

Reproducir en PowerShell, sin iniciar el servidor:

```powershell
$env:DISABLE_CRON='true'
npm.cmd run build
npm.cmd run lint
npm.cmd test -- --runInBand
npm.cmd run test:student-access-db
```

Antes de aplicar: aprobación explícita sobre SQL final, respaldo restaurable
confirmado, preflight de solo conteos (estudiantes-b-preflight.sql) y ventana fuera
de horario para el lock de practice_slots. Ninguna de esas acciones se ejecuta
contra Supabase en esta entrega. Después, verificar ACL/RLS/advisors y despliegue
backend antes de UI. No revertir eliminando auditoría o reactivando automáticamente
alumnos: una reversión operativa debe conservar historial y recuperación y evaluar
reservas que ya fueron tomadas por otros alumnos.

## Archivos tocados

Revisar primero migración, middleware y servicio de acceso: contienen los locks,
permisos, bloqueo de JWT emitidos y orden Auth/SQL.

SQL y producción:

- migrations/025_estudiantes_acceso.sql
- src/services/studentAccess.service.ts
- src/middlewares/auth.middleware.ts
- src/routes/studentAdmin.routes.ts
- src/config/database.types.ts
- src/services/realtime.service.ts
- src/services/practiceSlotScheduler.service.ts
- src/utils/practiceSlotIntegrity.ts
- package.json

Pruebas nuevas:

- tests/database/studentAccess.mjs
- tests/unit/studentAccess.service.test.ts
- tests/integration/studentAccess.test.ts

Pruebas existentes adaptadas (fixtures de rutas ahora declaran activo=true):

- tests/unit/auth.middleware.test.ts
- tests/unit/realtime.service.test.ts
- tests/unit/practiceSlotScheduler.service.test.ts
- tests/unit/practiceSlotIntegrity.test.ts
- tests/integration/cohorts.test.ts
- tests/integration/examAttempts.test.ts
- tests/integration/exams.test.ts
- tests/integration/instructors.test.ts
- tests/integration/manualEnrollmentDetails.test.ts
- tests/integration/practiceSlotActions.test.ts
- tests/integration/practiceSlotGeneration.test.ts
- tests/integration/practiceSlots.test.ts
- tests/integration/studentAdmin.test.ts
- tests/integration/users.test.ts

Documentación:

- docs/adr/013-politica-estudiantes.md
- docs/operations/estudiantes-b.md
- docs/operations/estudiantes-b-preflight.sql
