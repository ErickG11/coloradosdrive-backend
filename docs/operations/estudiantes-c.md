# C: asignación tardía de cohorte

Ticket sugerido: «Asignar cohorte a matrículas pendientes». Backend en
`feat/estudiantes-asignacion-cohorte`, sobre B/D. 027 NO aplicada a Supabase;
frontend posterior a revisión, PR/merge/tag del backend.

## Contrato

Solo admin autenticado; `authenticate` + `requireRole('admin')`:

- GET `/admin/estudiantes/:id/matriculas/:enrollmentId/cohortes`: devuelve
  `{ enrollmentId, courseId, suggestion: { cohortId, warning? }, items }`. Cada
  opción: id, nombre, precio, cuposDisponibles, fechaInicioMatricula,
  fechaFinMatricula, fechaInicioCurso. Fechas civiles YYYY-MM-DD. Sin opciones:
  items vacío y suggestion.cohortId null. No reserva cupo/precio.
- POST `/admin/estudiantes/:id/matriculas/:enrollmentId/asignar-cohorte`:
  `{ cohortId }`, sin otros campos. Actor de sesión. Respuesta: enrollmentId,
  cohortId, status activo, montoTotal, descuento, montoAbonado, saldo, updatedAt.

Validar pertenencia alumno/matrícula y course_id exacto. No reutilizar el contrato
por tipo A/B del wizard: comparte motor, pero sus opciones pueden ser de otros
course_id. C amplía CohortAssignmentService, sin duplicar selección ni consultas.

## Transacción y ventana compartida

SQL exacto: `migrations/027_estudiantes_asignacion_cohorte.sql`.
Una RPC SECURITY INVOKER, EXECUTE solo service_role, con actor admin y lock_timeout
5s. Locks alumno FOR SHARE → matrícula FOR UPDATE → cohorte FOR UPDATE.
El lock de alumno serializa con B/D; el guard existente rechaza D antes que
inactividad. Se revalidan abono/neto y curso; el trigger existente de cupo cuenta
activos bajo lock de cohorte (CD001). No cambia pagos, checklist, inscripción ni
practice_plan. Nunca crea prácticas.

`isCohortWindowOpen` contiene exactamente las comparaciones inclusivas de
assignCohort del Sprint 5; ambos usan schoolToday/SCHOOL_TIMEZONE. El backend valida
esa regla y envía su día civil y el texto original updated_at (sin Date, sin perder
microsegundos). Bajo lock, SQL solo compara versión y día actual de Guayaquil,
leído después de esperar los locks; no contiene un segundo predicado de ventana.
Una edición concurrente de cohorte o cruce de medianoche devuelve COHORT_CHANGED,
incluso si la ventana seguiría abierta: recargar y confirmar otra vez.
Los argumentos de validación son internos de service_role, nunca del body HTTP.
Un uso directo de esa credencial puede escribir tablas y no sustituye el contrato
del backend. Los errores de red no justifican repetir automáticamente el POST.

El precio se relee y valida en el backend al confirmar; la previsualización no
fija precio. La RPC rechaza cualquier cambio posterior a esa lectura por versión.
Importes calculados NUMERIC en SQL; saldo presentado con dos decimales.

Auditoría: cohort_assigned_by UUID sin FK y cohort_assigned_at, juntos en el mismo
UPDATE; filas previas quedan null. Solo una transición pendiente → activo.
Repetición a la misma cohorte activa es éxito sin UPDATE/otra auditoría, aunque la
ventana haya cerrado. Otra cohorte o estado: conflicto; C no reasigna.
D elimina esos metadatos con enrollments, sin ajustar su flujo.

## Errores

- CD001 → 409 COHORT_FULL; CD030 → 409 DELETION_PENDING.
- CD403 → 403 ACCOUNT_INACTIVE; CD404 → 404 STUDENT_NOT_FOUND.
- CD040 → 404 ENROLLMENT_NOT_FOUND; CD041 → 409 ENROLLMENT_NOT_PENDING.
- CD042 → 404 COHORT_NOT_FOUND; CD043 → 400 COHORT_COURSE_MISMATCH.
- CD044 → 409 COHORT_CHANGED; CD045 → 409 ABONO_EXCEEDS_NET.
- Ventana rechazada por helper TypeScript → 409 COHORT_WINDOW_CLOSED.
- 22023/validación de rutas → 400 INVALID_FIELD, field cuando se conoce.
- 42501 → 403 FORBIDDEN; 55P03/40P01 → 409 LOCK_CONFLICT (rechazo confirmado).
- Transporte, 57014 u otro resultado incierto → 503 UNCONFIRMED: recargar ficha
  y verificar antes de reintentar. Log estructurado solo IDs/evento, sin datos.

CD001 se verificó contra enforce_cohort_cupo de 020; CD030 contra el guard de 026.
La consulta de definiciones en qvyptmjmvrpewjynnnxs fue rechazada por permisos del
conector. No se afirma verificación en vivo: el preflight permite contrastar
metadatos sin imprimir definiciones ni datos de alumnos.

## Aplicación y rollback

1. Revisar SQL final, confirmar respaldo restaurable y ventana de ejecución.
2. Ejecutar preflight de solo lectura `estudiantes-c-preflight.sql`. Esperados:
   funciones=2, CD001=1, CD030=1, triggers=4, FK=1, RLS=1; forma inválida/sobrecupo=0.
   Inactivos/eliminaciones pendientes son informativos: C los rechaza.
3. Dry-run real autorizado BEGIN…ROLLBACK. Para 027 cambiar únicamente el commit
   final por rollback. El ensayo local no sustituye permisos/configuración reales.
4. Aplicar SQL solo con aprobación explícita; verificar ACL/RLS/advisors:
   anon/authenticated sin EXECUTE, service_role con EXECUTE, RLS de enrollments
   conservada. Después desplegar backend; frontend después.
5. Para revertir, retirar endpoints C y ejecutar `estudiantes-c-rollback.sql` con
   autorización. Solo DROP FUNCTION IF EXISTS; conserva columnas, constraint y
   valores. No revierte matrículas ni permite reejecutar 027 sin revisión.

## Prueba manual guiada: último cupo entre dos admins

Pendiente de ejecución. Usar PostgreSQL desechable con datos ficticios y 027;
sin Docker, sin proyecto real. No se presenta el runner PGlite como concurrencia.

1. Preparar dos alumnos activos distintos, cada uno con matrícula pendiente del
   mismo course_id y abono <= precio; una cohorte abierta con exactamente un cupo.
   Dos admins, A y B. Mantener DISABLE_CRON=true en cualquier backend local.
2. Obtener opciones para ambas matrículas y comprobar que ven la misma cohorte.
3. En una sesión PostgreSQL A iniciar una transacción y llamar a
   assign_pending_enrollment_cohort para A, pasando el día y la versión validados
   por el helper del backend. Mantenerla abierta sin commit.
4. En otra sesión B llamar a la RPC para la otra matrícula/cohorte antes de 5s;
   observar que espera el lock. Confirmar A antes de agotar lock_timeout.
5. B debe terminar con CD001 (HTTP COHORT_FULL); solo una matrícula quedó activa.
   La otra sigue pendiente, con total null, abono/checklist intactos y auditoría
   null. Verificar únicamente conteos, sin imprimir perfiles.
6. Variante: mantener A abierta más de 5s; B devuelve 55P03/LOCK_CONFLICT y no
   cambia nada. Reintentar manualmente tras recargar.
7. Misma matrícula, cohortes distintas: un ganador; segunda llamada CD041.
   Misma matrícula/cohorte: repetición devuelve éxito y conserva actor/fecha.
8. Verificar cruces con B y D: si desactivación o inicio de eliminación obtiene
   primero el lock del alumno, C rechaza ACCOUNT_INACTIVE/DELETION_PENDING. Si C
   termina primero, B/D siguen después. Un deadlock aborta sin cambios; recargar.

## Verificación local

`DISABLE_CRON=true npm run test:student-cohort-db`: base en memoria aislada, sin
.env/red/datos reales. Carga migraciones versionadas relevantes 001–026, excluye
seed 003 y listado 023. Ensaya 027 BEGIN…ROLLBACK (0 columnas/funciones persistidas),
luego la aplica solo en memoria para probar ACL, códigos y reglas secuencialmente.
Prueba diferencia de un microsegundo y día distinto, cupo secuencial, auditoría,
conservación de matrícula/checklist/plan, cero prácticas, repetición y rollback
dos veces conservando columnas/valores; compatibilidad con D.
Jest prueba helper inclusivo/Guayaquil, opciones, payload interno con seis
decimales exactos, códigos, validación HTTP y RBAC. Sin simulación de concurrencia.

Resultado local: build y lint correctos; Jest completo 47 suites/676 tests;
revalidación focalizada tras ajustes de lint 3 suites/64 tests. Ensayo SQL y
preflight correctos, sin función/columnas persistidas tras el dry-run; rollback
operativo probado dos veces conservando columnas/valores. Quedan pendientes el
contraste de metadatos real, el dry-run real autorizado, respaldo y prueba manual
de dos sesiones. No se aplicó SQL en Supabase ni se inició el servidor.

Archivos de C:

- migrations/027_estudiantes_asignacion_cohorte.sql.
- src/services/cohortAssignment.service.ts, studentCohort.service.ts.
- src/models/cohortAssignment.model.ts, studentCohort.model.ts.
- src/routes/studentAdmin.routes.ts, src/config/database.types.ts.
- tests/unit/cohortAssignment.service.test.ts, studentCohort.service.test.ts.
- tests/integration/studentCohort.test.ts, tests/database/studentCohort.mjs.
- package.json (solo script de test, sin dependencias nuevas).
- docs/adr/013-politica-estudiantes.md y los tres documentos operativos C.
