# Entrega D: eliminación definitiva de alumnos

Estado: plan aprobado. D implementada localmente sobre la rama de B; 026 sin aplicar.
B (025) aplicada y verificada por el responsable; no se ejecuta SQL real en esta entrega.
Ticket sugerido: «Backend: eliminación definitiva de alumnos confirmada y reintentable».

## Dependencia y alcance

Implementar y verificar B antes de D: activo/ban, middleware, rutas excepcionales,
Realtime, cancelación/recuperación de reservas y demás alcance de B. El ban no
invalida JWT ya emitidos. B sigue siendo una acción independiente y reversible;
el admin no necesita desactivar previamente para usar D.
Cada entrega conserva SQL revisado, pruebas, PR/merge/tag y después frontend.
C mantiene su alcance independiente.

D inicia una sola acción admin irreversible. Orden aprobado:
bloqueo → Storage → transacción de datos/auditoría → Auth → completo.
Conservar las FKs existentes: users.id → auth.users ON DELETE CASCADE y
RESTRICT desde matrículas, intentos, prácticas y solicitudes hacia users.
No eliminar Auth antes de la transacción de datos.

## Endpoints admin implementados

Todos con authenticate + requireRole('admin'):

- POST /admin/estudiantes/:id/eliminar. Inicio con cuerpo
  { "confirmacionCedula": "<cédula escrita>" }; comparar exactamente con la cédula
  actual del alumno del UUID antes de cualquier efecto. Ausente/no coincidente:
  rechazo sin crear operación ni bloquear acceso. No guardar valor ni hash.
- El mismo POST, cuerpo vacío {}, reanuda únicamente un registro ya confirmado
  en estado pendiente o fallido. No iniciar una eliminación nueva sin cédula.
  Reutilizar la confirmación inicial y registrar al admin que reintenta.
  Una operación completa solo devuelve «ya completada», sin ejecución ni cambios.
- GET /admin/estudiantes/eliminaciones. Listado paginado, por defecto pendiente
  y fallido; estado opcional pendiente/fallido, page/pageSize y orden estable
  updated_at/student_id. Registrar esta ruta estática antes de GET /:id.
  Devolver UUID del alumno, estado, siguiente fase, actor inicial, fecha de
  confirmación y último admin/fecha/contador de reintentos. Sin JOIN obligatorio
  a users: debe funcionar después de borrar el perfil. Sin cédulas, nombres,
  correos ni rutas Storage. La UI ofrece «Reintentar eliminación».

No registrar el cuerpo de POST en logs, errores, trazas ni instrumentación.
El backend actual no tiene un logger de cuerpos; D mantendrá esa propiedad.
Logs operacionales permitidos: identificadores, fase, código seguro de error y
actor del reintento; nunca el body ni mensajes crudos de proveedores.

## Persistencia mínima: por qué hace falta una tabla

student_deletion_operations: una fila por student_id UUID, sin FK al
perfil/Auth que desaparecerán. Campos: actor_id inicial, confirmed_at (marca
durable de confirmación, sin cédula), fase siguiente, estado pendiente/fallido/
completo, last_retry_actor_id, last_retry_at, retry_count y updated_at.
Para la auditoría transaccional: data_deleted_by y data_deleted_at registran
quién ejecutó efectivamente el borrado de datos y cuándo. La misma fila sirve
como registro de operación y auditoría mínima; no crear otra tabla de auditoría.
Al completar, updated_at registra la finalización y la fila deja de mutarse.

Es necesaria para recuperar Auth pendiente y listar el trabajo tras borrar users.
No reutilizar manual_enrollment_operations: es idempotencia de matrícula, con
estados y campos obligatorios distintos, y D elimina las operaciones vinculadas.
No reutilizar student_profile_audit: es auditoría inmutable de campos editados,
con CHECK de nombres de campo; no representa fases, confirmación ni reintentos.
Generalizarlas ampliaría contratos ya entregados y mezclaría responsabilidades.

No persistir rutas Storage, copias de Auth ID, payloads, perfiles, datos personales
del alumno ni hashes de cédula. El UUID del alumno es el Auth ID original.
Conservar solo identificadores/fechas operativos y de auditoría. RLS activo y
acceso exclusivo backend; SQL exacto y permisos se propondrán para aprobación.
Cada reintento manual actualiza último actor/fecha/contador y emite un log
estructurado con ese actor. No se propone un historial ilimitado dentro de la fila.

## Ejecución por petición y reintentos

1. Validar confirmación y reservar la fila de operación bajo concurrencia. Marcar
   confirmed_at antes de iniciar efectos. No duplicar la operación por alumno.
2. Primer paso efectivo: activo=false y ban en Auth; confirmar ambos antes de
   borrar archivos o datos. No compensar reactivando si un paso posterior falla.
3. Consultar solicitudes exclusivamente por student_id y sus storage_path en
   solicitud_documentos. Leer y eliminar los objetos antes de la transacción;
   conservar sus filas/rutas en la base hasta confirmar la limpieza de Storage.
   Ante crash o fallo, releer esas mismas filas al reintentar y eliminar otra vez:
   un objeto ya ausente cuenta como éxito confirmado. No buscar por cédula/correo.
4. Transacción con locks y lock_timeout: verificar fase y que siguen cubiertas las
   rutas actuales; si aparecieron rutas no limpiadas, no borrar sus filas y volver
   al paso Storage. Documentos de solicitudes → solicitudes; respuestas → intentos;
   tratamiento de prácticas abajo; checklist → matrículas; operaciones de
   matrícula manual vinculadas; perfil al final. Incluir pagos si ya existen.
   Confirmar auditoría y fase Auth en la misma transacción. Ante rollback, no
   avanzar de fase. Un RESTRICT inesperado detiene la operación, sin borrar ajenos.
5. Eliminar Auth usando el student_id persistido, aunque el perfil ya no exista.
   Si falla, conservar la fase Auth. Marcar completo solo tras confirmar ausencia
   de esa cuenta y éxito de todos los pasos.

Cada paso es repetible. El estado durable indica qué falta, no se interpreta un
timeout como rollback ni la ausencia del perfil como finalización. Cambiar de fase
con condiciones y locks evita regresiones por peticiones concurrentes; las APIs
externas pueden repetirse de forma idempotente. Un fallo tardío no debe sobrescribir
un avance posterior. Registrar reintentos solo sobre estados pendiente/fallido.

No hay ejecución periódica: la petición del admin ejecuta la secuencia. Reiniciar
Railway no pierde fase/estado; el botón retoma la misma operación confirmada.
Como máximo un reintento automático por petición, solo ante fallo transitorio y
después de reconciliar resultado/fase. No repetir por validación o permisos, ni
crear bucles; si persiste el fallo, registrar fallido y ofrecer reintento manual.
Una petición interrumpida puede quedar pendiente hasta que otro admin la retome.
Una operación completa no se reintenta.

## Bloqueos acotados

Consultar eliminación pendiente/fallida solo en las entradas admin que editan al
alumno, reactivan su cuenta o crean matrículas (incluida aprobación de solicitudes
cuando termina matriculando). Reutilizar un guard común en esos flujos y proteger
su escritura contra una carrera con el inicio de D; no ampliar el bloqueo a cada
endpoint. El resto de accesos lo cubren activo=false, ban y middleware de B.
Mantener las comprobaciones actuales de solicitudes que ya no admiten documentos.
Probar peticiones que estaban en curso al bloquear y releer/validar rutas antes
de eliminar filas; no añadir por defecto nuevos bloqueos a subidas o prácticas.
«Cancelar» solo cierra el diálogo antes de confirmar; D iniciada no es reversible.

## Prácticas: conservar inventario futuro

El modelo real es inventario del instructor: instructor_id y cohort_id obligatorios,
scheduled_at, duración 60 minutos y student_id opcional. La UI del instructor lista
todas sus franjas. Estados libres existentes: disponible/liberado; no existe libre.
El CHECK permite student_id NULL solo en disponible/liberado/sin_practica;
asignado/confirmado/completado requieren alumno. attended no nulo exige completado.

En la transacción, tomar un instante de corte de servidor tras adquirir los locks:

- Futuras (scheduled_at > corte), aún vinculadas al alumno: conservar la fila,
  instructor, cohorte y horario. Poner student_id=NULL y status=liberado; limpiar
  asistencia y metadatos de confirmación/avisos del alumno conforme al contrato
  de liberación existente. No enviar recordatorios al alumno borrado. Que la
  franja sea reclamable sigue sujeto a la ventana actual de cinco minutos.
- Ya iniciadas o pasadas (scheduled_at <= corte): política aprobada, borrar
  solo filas todavía vinculadas al alumno. Desvincular completado incumpliría el
  CHECK; convertirlo en sin_practica/liberado falsearía asistencia y resultado.
  Borrar elimina el vínculo y los datos del alumno sin añadir estados/columnas.
  Costo: se pierde esa franja del historial/estadísticas del instructor. No se
  vuelve a ofrecer un horario ya iniciado ni se borra una cohorte/instructor.
- Limpiar los registros de recuperación de B ligados al alumno. Si B ya liberó
  una franja y otra persona la reservó, no tocar esa nueva reserva ni su historial.

Revisar anomalías temporales/estados en preflight y no tocar franjas ajenas.
Los exámenes/preguntas compartidos se conservan; se borran intentos y respuestas.

## Diálogo

Mantener el texto proporcionado, con nombre solo en pantalla y el botón
deshabilitado hasta coincidencia exacta. La comprobación del servidor es obligatoria.

> Eliminar definitivamente a [Nombre del alumno]
>
> Esta acción no se puede deshacer. Se eliminarán:
>
> - Su cuenta de acceso
> - Sus matrículas y checklist de documentos
> - Los exámenes que haya rendido
> - Sus prácticas
> - Sus solicitudes de inscripción y archivos adjuntos
>
> Si solo quieres que no pueda ingresar, usa "Desactivar": es reversible.
>
> Para confirmar, escribe la cédula del alumno: [ __________ ]
>
> [Cancelar]   [Eliminar definitivamente]

«Sus prácticas» elimina su vinculación y sus datos; las franjas futuras del
instructor se conservan libres. «Exámenes que haya rendido» son sus intentos y
respuestas, no exámenes/preguntas compartidos.

## Pruebas y requisitos de despliegue

Datos ficticios: confirmación errónea sin efectos; activo/inactivo; bloqueo
incompleto; crash/timeout en cada fase; único reintento automático; reintento por
otro admin registrado; operaciones completas no ejecutadas otra vez; listado sin
perfil; auditoría única; cuerpo/cédula ausentes de logs y persistencia; carreras de
peticiones, edición/reactivación/matrícula y subidas en curso; liberación futura,
borrado pasado/iniciado, asistencia y CHECKs; reserva reutilizada por otro alumno
intacta; Storage ya ausente y rutas reconsultadas después de fallo.

Repetir inventario antes de D: hoy no hay payments; incluirlos si RF-04 los agrega.
manual_enrollment_operations tiene request_hash/response, no request; limpiar su
fila vinculada y cualquier request que exista entonces. Un RESTRICT de autoría
inesperado exige revisión sin borrar registros ajenos para satisfacerlo.
No existe transacción global con Storage/Auth; lo recuperable no es reversible.
Implementación local terminada, pendiente de revisión de SQL final, dry-run real
con rollback y respaldo restaurable confirmado antes de aplicar.

## SQL, ejecución y límites de esta entrega

SQL exacto: migrations/026_estudiantes_eliminacion.sql. No cambia FKs ni agrega
dependencias, procesos, claves de entorno, tokens, cifrado o índices adicionales.
Para unos 200 alumnos, el listado de operaciones usa la PK y ordena las pocas filas.
La tabla tiene RLS, sin políticas públicas, sin FK, SELECT/INSERT/UPDATE solamente
para service_role y sin DELETE. Solo UUIDs, fechas, fase, estado y contador; sin
cédula/hash, correo, nombre, rutas, errores crudos ni payloads. Completo se conserva.
student_profile_audit y student_access_audit conservan sus metadatos sin valores.

Fases persistidas: bloqueo → storage → auth → completo. Storage incluye la limpieza
y la transacción de datos; esta confirma data_deleted_by/data_deleted_at y phase=auth
en el mismo commit. Tras Auth, updated_at registra la finalización. Una sola tabla
es suficiente; no se agrega una segunda auditoría. Cada RPC comprueba admin en BD.
El bloqueo inicial activo=false comparte transacción con la confirmación durable.
Se confirma el ban (o Auth ausente) antes de avanzar a Storage. En Auth se usa
users.id original, persistido como student_id; ausencia 404 cuenta como éxito.

El endpoint POST responde 200 con la operación cuando está completa (incluido
replay), 400 INVALID_CONFIRMATION si una confirmación nueva no coincide, 404
STUDENT_NOT_FOUND para UUID sin alumno/operación y 503 DELETION_INCOMPLETE si hay
que reintentar. Un fallo incierto al iniciar responde 503 UNCONFIRMED sin ejecutar
efectos externos; consultar el listado antes de repetir. Validaciones de entrada
devuelven 400. Nunca se reflejan el cuerpo ni mensajes crudos de proveedores.
Incluso el error del parser JSON se sanitiza para esta ruta antes de log/respuesta.
El GET devuelve {items,total,page,pageSize}; items tiene los campos de la tabla,
sin JOIN a users. Filtro `estado` opcional: pendiente/fallido. Por defecto ambos;
orden updated_at DESC, student_id ASC, page=1, pageSize=20 (máximo 100).

La reanudación registra al último admin y aumenta retry_count; el reintento
automático no llama otra vez a begin ni aumenta ese contador manual. Hay como
máximo UNO por petición, compartido entre fases; solo ante red/timeout/errores
transitorios, rutas cambiadas o CAS contendido. Antes de repetir se reconcilia
la fase con la fila actual; perder un CAS también consume ese presupuesto. CAS usa
fase y updated_at exacto (string con microsegundos), de modo que un fallo tardío
no pisa un avance/reintento ajeno. Peticiones concurrentes pueden repetir las
APIs externas de forma idempotente; no hay una transacción global ni un lock
persistente de ejecución. Un límite de ocho pasos evita bucles por contención;
si no termina, responde 503 y conserva el progreso para el botón del admin.

Guard común previo a Auth en edición/reactivación y matrícula manual existente;
triggers en UPDATE de campos de perfil, UPDATE de activo=true, INSERT de matrícula
y vinculación student_id al aprobar solicitud. Bajo lock de users, cierran las
escrituras que estaban en vuelo al iniciar D. Un unban en vuelo se vuelve a banear
si los controles posteriores detectan D. La escritura SQL de perfil rechazada
por D no compensa el correo de una cuenta en eliminación. No se agregan guards a
subidas ni a prácticas: se mantienen B, las validaciones de solicitudes y sus FKs.
La transacción bloquea padres/documentos, relee rutas actuales y exige que estén
en las limpiadas en esa petición; una nueva ruta aborta sin borrar sus filas.
Una subida ya en curso que pierde su padre falla por FK y usa su compensación
existente para quitar el objeto subido. No se borran solicitudes por identidad.

Riesgos: deadlocks bajos por órdenes de lock distintos (asignación directa,
matrícula, solicitud); 40P01/lock_timeout entran en el presupuesto de un reintento.
Fallo definitivo/RESTRICT deja fallido sin borrar Auth; datos/auditoría hacen rollback
juntos. Si Storage se limpió antes, su ausencia no se puede revertir: las filas
quedan como referencias para completar la eliminación. Sin garantía de entrega
de avisos de franja liberada por D; el inventario se ve al refrescar la API.

No fue posible repetir la inspección del proyecto real: el conector devolvió
permiso denegado antes de leer esquema/datos. Preflight SOLO CONTEOS:
estudiantes-d-preflight.sql. Debe confirmar payments ausente, autorías/FKs no
inventariadas y las relaciones antes de autorizar. El esquema versionado tiene
request_hash/response en manual_enrollment_operations: borrar la fila entera
cubre también request si se añadiera. Si aparece payments, 026 y la RPC de datos
se detienen: hace falta adaptar SQL a su contrato real antes de borrar pagos.

Rollback operativo: estudiantes-d-rollback.sql. Retira RPCs/guards, sin CASCADE;
conserva operaciones/RLS/grants, activo y bans. Se niega a retirar guards mientras
haya operaciones pendientes/fallidas. No recupera perfiles, archivos ni Auth.
Retirar endpoints D y pausar peticiones; no reejecutar 026 sobre la tabla conservada.

Prueba aislada: `$env:DISABLE_CRON='true'; npm.cmd run test:student-deletion-db`.
Carga migraciones versionadas relevantes en PGlite 0.5.10 / PostgreSQL 18.6;
prueba 026 con BEGIN/ROLLBACK y rollback operativo con BEGIN/ROLLBACK y repetición.
Solo datos ficticios, sin .env ni red. No reproduce PostgreSQL 17.6 del proyecto,
sesiones concurrentes reales ni APIs reales de Auth/Storage (probadas con mocks).
Prueba confirmación/roles, guards, cambio de rutas, RESTRICT sin pérdida parcial,
inventario/ajenos, auditoría/reintentos/CAS, ausencia de perfil, completo inmutable,
permisos/RLS y preflight. Tests Jest cubren endpoints, errores/404/reintento único,
respuestas perdidas, unban en vuelo y cuerpo ausente de logs, incluso JSON inválido.

Orden pendiente: aprobar SQL + confirmar respaldo → preflight/dry-run real → aplicar
026 → verificar ACL/RLS/advisors → desplegar backend → frontend después.

## Archivos tocados

Revisar primero 026, StudentDeletionService y los guards de perfil/reactivación:
contienen confirmación, orden externo, CAS y protección de escrituras en vuelo.

- migrations/026_estudiantes_eliminacion.sql
- src/services/studentDeletion.service.ts
- src/services/studentProfile.service.ts
- src/services/studentAccess.service.ts
- src/services/manualEnrollment.service.ts
- src/routes/studentAdmin.routes.ts
- src/config/database.types.ts
- src/middlewares/errorHandler.ts
- package.json
- tests/database/studentDeletion.mjs
- tests/unit/studentDeletion.service.test.ts
- tests/integration/studentDeletion.test.ts
- tests/unit/studentProfile.service.test.ts
- tests/unit/studentAccess.service.test.ts
- tests/unit/manualEnrollment.service.test.ts
- tests/integration/studentAdmin.test.ts
- docs/adr/013-politica-estudiantes.md
- docs/operations/estudiantes-d-plan.md
- docs/operations/estudiantes-d-preflight.sql
- docs/operations/estudiantes-d-rollback.sql

Las cuatro pruebas existentes solo adaptan el estado de eliminación ausente o
añaden casos de carrera de D; no se cambian sus contratos anteriores. La edición
local previa de 023 se mantiene fuera de esta entrega.

Resultado local final: build y lint correctos; Jest, 45 suites / 630 pruebas
correctas; `test:student-deletion-db` correcto. El ensayo aislado completo de 026,
el rollback operativo y el preflight solo usan datos ficticios y no tocan Supabase.
