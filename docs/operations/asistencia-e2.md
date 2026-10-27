# Asistencia E2: cambio por cupo

Rama `feat/asistencia-cambio-cupo`, desde E1 `8df062e`. Migración propuesta:
`031_asistencia_cambio_cupo.sql`. 031 no aparece en migrations/ ni en borradores
previos; el borrador de Cohortes sigue usando 030 fuera de migrations/.
Esta entrega no aplica SQL remoto ni despliega el backend.

## Fuentes y decisiones

`manualPracticePlan()` (`src/utils/manualPracticePlan.ts`) devuelve `horasPorDia`
y `horas`. `ManualEnrollmentService.confirm()` combina ese plan con el input en
`storedPlan`; `commit_manual_enrollment` (022) lo persiste en `practice_plan`.
No se inventan valores diarios, fechas o modalidades.

Objetivo = `enrollments.horas_practica_objetivo` cuando no es nulo; de lo contrario
`practice_plan.horas` (la matrícula manual actual no llena el primero).
Horas programadas = suma de `duration_minutes / 60` de prácticas propias de esa
cohorte en `asignado`, `confirmado` o `completado`. Son bloques de una hora.
Horas sin programar = máximo(objetivo − programadas, 0).

Reposiciones A pendientes = mínimo(horas sin programar, cancelaciones propias
`reprogramable` de origen `alumno` aún no enlazadas a una reposición). Esta segunda
condición evita que una falta, hora perdida o una matrícula incompleta por otra
causa cree un derecho a reposición. El objetivo mide planificación para E2;
NO sustituye el cálculo de asistencia real para certificar RF-07.

Se añaden tres columnas al historial E1: `origen` (`alumno` por defecto o
`cambio_cupo`), `repuesto_por_slot_id` y `repuesto_en`. No hay estados nuevos ni
tablas nuevas. Las dos últimas son una instantánea que permite saber qué
cancelación se repuso, incluso si la franja se reutiliza después. Un CHECK exige
el par completo y resultado `reprogramable`. No hay FK al slot reutilizable.

B registra motivo de categoría `otro`, texto de sistema y origen `cambio_cupo`,
con reposición enlazada en la misma transacción. Se conserva sin cambios el CHECK
de las seis categorías de E1 y el formulario del alumno no puede escoger un
motivo de sistema. A enlaza la cancelación pendiente más antigua, sin consumir
otro cambio. El contador nunca se reinicia.

**Datos anteriores a E2:** no es posible reconstruir con certeza si un antiguo
`claim` repuso una cancelación E1. El preflight enumera las matrículas con ese
historial para revisión humana. El déficit limita horas nuevas, pero no corrige
la trazabilidad histórica. Resolver esos casos antes de habilitar E2; no hay
backfill automático.

## Elegibilidad y atomicidad

`private.eligible_practice_slot_changes()` reutiliza el helper de E1 por cada
posible origen; añade saldo de reposición y cupo diario. En A se evalúa sin origen;
en B solo se excluye la práctica seleccionada. El cupo diario suma los bloques
`asignado`, `confirmado`, `completado` de esa matrícula/cohorte en el día civil
America/Guayaquil, aun si `attended` es nulo o falso. Una práctica completada
no puede soltarse. Cambiar una futura dentro del mismo día sí puede dejar hueco.
No se suman horas de una matrícula distinta al plan que limita ese día; los cruces
del alumno se comprueban globalmente por E1 y por la exclusión GiST.

`swap_practice_slot()` bloquea alumno, matrícula y después ambas franjas ordenadas
por UUID; relee elegibilidad/estado/reloj después de esperar. El alumno se bloquea
FOR UPDATE para serializar también acciones en otras matrículas suyas. El
instructor del destino se mantiene activo con FOR SHARE. En B se libera primero
el origen, evitando una violación temporal GiST si origen y destino se cruzan.
Un error revierte franja, contador e historial juntos. El segundo competidor por
el mismo cupo recibe CD409; timeout/deadlock se traduce al 409 existente.

No se añade una tabla ni se reemplaza `delete_student_data`: la versión 030 ya
borra la fila entera del historial antes de la matrícula. Su definición y sus
guards se mantienen; el ensayo de eliminación incluye los nuevos metadatos,
comprueba preservación tras rollback por FK y limpieza al completar.

RPC/helpers son SECURITY INVOKER con search_path vacío, EXECUTE solo service_role.
La RLS del historial sigue habilitada; service_role obtiene UPDATE únicamente de
las dos columnas de reposición, sin permiso de editar motivos/resultado.

Referencia de bloqueos: https://www.postgresql.org/docs/current/explicit-locking.html
Referencia de permisos RPC: https://supabase.com/docs/guides/database/functions

## Contratos HTTP (JWT de estudiante)

- `GET /practice-slots/released-for-me`: array ordenado por fecha/id. Cada elemento
  tiene `id`, `cohortId`, `enrollmentId`, `scheduledAt`, `durationMinutes`, `status`,
  `caso` A/B, `via` reposicion/cambio, `practicasASoltarIds`,
  `reprogramacionesRestantes`. No incluye identidad de otros alumnos ni instructor
  de franjas libres. En A la lista de orígenes está vacía; en B indica SOLO los
  orígenes válidos para ese destino, no todas las prácticas del selector.
- `GET /practice-slots/my-pending`: array `{slot: PracticeSlot, enrollmentId}` de
  prácticas futuras propias que pueden utilizarse como origen B (matrícula activa,
  sin crédito A pendiente y menos de dos cambios). El frontend debe intersectarlo
  con `practicasASoltarIds` del cupo elegido.
- `POST /practice-slots/:id/swap`: `{}` para A o `{practicaASoltarId: UUID}` para B.
  El UUID se valida con express-validator; requerimiento/prohibición según el
  caso se decide en SQL bajo locks, evitando un chequeo separado susceptible a
  carreras. Devuelve `{slot: PracticeSlot, caso, practicaSoltadaId, cancellationId,
  enrollmentId, reprogramacionesRestantes}`. Estado final del destino: asignado.
  El origen B queda liberado. Datos extra de actor/contador del body se ignoran.

400: falta origen B, origen enviado en A o UUID inválido. 403: cuenta/cohorte no
permitida. 404: destino inexistente. 409: cupo ocupado/cerrado/no elegible, origen
iniciado/ajeno, plan incompleto, cuota agotada o conflicto de escritura.
Los GET pueden responder 409 ante un plan incompleto: no ocultan el problema ni
proponen alternativas basadas en valores inventados.

El antiguo `/claim` también usa swap sin origen: sirve para A; B exige `/swap`.
Se reemplaza `act_on_practice_slot` para que incluso un consumidor E1 que llame
directamente a su acción claim pase por SQL de E2. Confirm sigue usando el helper
privado original. `private.book_practice_slot` se conserva para recuperación
administrativa; no es una vía HTTP libre para alumnos.

## Broadcast y margen

Tras el commit se intenta enviar `slots-updated` vacío al canal personal del
alumno y `slot-taken` vacío a la cohorte del DESTINO. Este último invalida el cupo
que ya se tomó; no oferta el origen. Nunca se envía `slot-released` por el origen
B ni se difunde a otra cohorte. El frontend E2 deberá escuchar esos eventos; la
UI E1 todavía no incorpora el selector B ni esos manejadores.

No hay efectos si la RPC falla. Los avisos son best-effort independientes; un
fallo personal no impide intentar la invalidación de cohorte ni revierte el
cambio. No hay cola persistente/reintentos en esta entrega.

Destino con 5 minutos o menos nunca entra en elegibilidad ni se toma; SQL vuelve
a comprobar el margen con clock_timestamp después de los locks. La 030 no se
modifica: cancelar a T-5 o después conserva `difundirCohorte=false`, pasa a
sin_practica y solo avisa al instructor. La invalidación `slot-taken` informa de
un cupo OCUPADO, no es una oferta, aunque el envío se demore tras el commit.
El origen B se libera en silencio aun si ya está a menos de cinco minutos; el
scheduler vigente lo cerrará y avisará al instructor.

## Operación y comprobaciones

1. Leer `asistencia-e2-preflight.sql` y ejecutarlo como consulta de solo lectura.
   Requiere E1 y `pg_input_is_valid` (PostgreSQL 16+); comprobar la versión del
   servidor y adaptar solo el diagnóstico si es anterior. La RPC no depende de
   esa función. Revisar planes incompletos y cancelaciones/reclamos históricos.
2. En ventana coordinada, una persona aplica 031 una sola vez desde SQL Editor
   y ejecuta `asistencia-e2-verificacion.sql` ENTERO, con su ROLLBACK final.
3. Desplegar este backend después de 031. Antes de 031, las RPC nuevas no existen.
   `/claim` ya cambia de semántica al aplicar 031: coordinar su activación con E2
   de frontend o mantener el acceso al cambio B cerrado hasta entonces. No hay
   un orden sin impacto sobre el antiguo claim; no activar cada parte sin revisar.
4. Rollback solo con backend E2 retirado y sin metadatos E2 persistidos. El script
   aborta si perdería auditoría; si E2 se usó, preparar corrección de avance.

Pruebas locales: `DISABLE_CRON=true npm run test:practice-swap-db`,
`test:student-deletion-db`, tests Jest de rutas/servicio afectados, build y lint.
Resultado de esta entrega: 65 tests Jest en 4 suites, los ensayos SQL E2,
eliminación y cancelación E1, build y lint correctos. Se conserva el aviso
TS151002 de ts-jest preexistente; la ejecución directa de Jest terminó con código 0.
PGlite usa una conexión y no lee .env ni abre red. Ensaya aplicación/reversión
exacta del wrapper, reversión protegida, ACL/RLS, A/B, segundo consumo, rechazo
con dos usadas, A permitido con dos usadas, cruce, mismo día, cupo completado,
T-4 y cancelación tardía E1. Los fixtures terminan en ROLLBACK.

La prueba de dos solicitudes usa el orden serial equivalente; NO prueba espera
real entre conexiones. Para cerrar ese riesgo en PostgreSQL desechable/staging:
preparar dos alumnos elegibles B, dos orígenes propios y un destino común; sesión
1 ejecuta BEGIN + swap y retiene la transacción; sesión 2 intenta swap al mismo
destino; verificar que espera, confirmar sesión 1 y comprobar CD409 en sesión 2,
con su práctica y contador intactos. Repetir invirtiendo el ganador. Usar fixtures
descartables porque confirmar el ganador persiste su cambio; este ensayo real
no forma parte del script de una conexión terminado en ROLLBACK.

El conector denegó la consulta de solo lectura a qvyptmjmvrpewjynnnxs. No se ha
verificado versión, datos, ACL/RLS desplegadas ni aplicación de 030/031 en remoto.
La aplicación previa de 030 procede de la información del usuario. No se ejecutó
SQL remoto de escritura, migración, correo, Broadcast ni despliegue.

## Propósito en lenguaje simple

La elegibilidad evita ofrecer al alumno un horario que no puede tomar y aplica
el límite diario de su propio plan. La RPC hace todo el cambio de una vez: toma
el cupo y, si corresponde, suelta la práctica anterior y consume un cambio.
El endpoint de cupos para mí devuelve solo las opciones válidas para ese alumno.
El de prácticas pendientes permite elegir cuál de sus prácticas futuras cambiar.
La regla de silencio evita que una práctica soltada origine otra ronda de avisos
y cambios encadenados en toda la cohorte.
