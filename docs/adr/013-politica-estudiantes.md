# ADR 013: Administración y eliminación de estudiantes

## Estado

Diseño aprobado en dirección; A1 y A2 implementadas para revisión en sus ramas.
Migraciones 023 y 024 aplicadas al proyecto real con aprobación explícita.
B (025) y D (026) aplicadas en Supabase el 15/10/2026: 025 mediante
`apply_migration`; 026 manualmente desde SQL Editor, por lo que no figura en el
historial de migraciones. Backend C implementado para revisión en
feat/estudiantes-asignacion-cohorte; 027 sin aplicar y frontend pendiente.

## Decisión

Backend primero, PR/merge/tag y después frontend. El chore de cron precede A1.
Cada entrega tiene migración, pruebas y PR propios. A se divide en A1 listado/
ficha de solo lectura y A2 edición. No duplicar users, matrículas, documentos,
abono, solicitudes ni la lógica de selección/asignación de cohorte del Sprint 5.

A1 tiene una RPC de listado, una función canónica de vigencia e índices B-tree.
Busca solo nombre/cédula/teléfono, sin Auth por fila; una fila por alumno,
desempate por id, filtros combinados sobre la misma matrícula e historial optativo.
Activo es del usuario, independiente de matrícula. Sin filtros aparecen alumnos
sin matrículas. Ficha por lotes y cálculo de abono/checklist reutilizado.

A2 es simple: una transacción UPDATE + auditoría de nombres de campos,
actor, fecha e identificador, sin valores/hashes. Validación de cédula y unicidad
antes de Auth; constraint única conserva protección concurrente. Correo solo
en Auth, actualizado primero, una compensación ante rechazo SQL confirmado.
Sin operaciones persistentes, tokens, cifrado ni clave de recuperación. Los
crashes requieren revisión manual. UUID generado en backend y log previo a Auth
sin valores. Compensar una vez solo ante rechazos definitivos RPC: 23505, CD409,
22023 y CD404. Distinguir 23505 de cédula y de auditoría por nombre de restricción.
Timeout/red u otros errores: 503 para revisar manualmente, sin compensar ni
consultar auditoría para decidir; una respuesta perdida no demuestra rollback.
Detalle y límites concurrentes: operations/estudiantes-a2-propuesta.md.

PATCH expone códigos de error estables además de message: CEDULA_DUPLICATE
(409, field=cedula), EMAIL_DUPLICATE (409, field=correo), VERSION_CONFLICT (409),
INVALID_FIELD (400, field si la validación identifica el campo), AUTH_REJECTED
(400, otros rechazos de Auth) y UNCONFIRMED (503, resultado incierto).
AUDIT_CONFLICT distingue la PK de auditoría y STUDENT_NOT_FOUND identifica 404.
No incluir valores del perfil ni detalles crudos de Auth/PostgreSQL en errores.

Mantener bloqueo optimista en A2: trigger real habilitado en cada UPDATE y
updated_at con seis decimales. Transportar el string exacto sin Date de JS.

B implementada en feat/estudiantes-desactivar-reactivar; SQL 025 aplicada y
verificada por el responsable. B bloquea acceso del alumno inactivo o sin perfil, incluidas rutas excepcionales
y autorizaciones Realtime, combinando activo y ban en Auth. Desactivación:
cancelar solo reservas futuras con motivo trazable, conservar matrícula, cupo,
abono, prácticas pasadas y asistencia. Reactivación: acceso primero y recuperación
individual por la lógica existente; conflictos pendientes de reprogramar.
Canales ya abiertos pueden recibir señales vacías hasta que expire el JWT; sin datos expuestos.
La auditoría de acceso solo conserva IDs/acción/fecha; una tabla de recuperación
guarda las reservas canceladas por desactivación, necesaria al liberar student_id.
Tras D, student_access_audit conserva solo UUIDs del alumno/actor, acción y fecha, sin valores personales ni FK al perfil.
No hay procesos nuevos ni claves de entorno nuevas. SQL y verificaciones:
operations/estudiantes-b.md. Los fallos de reservas no revierten el acceso reactivado;
los fallos de Auth/BD sí requieren revisión y reintentar la misma acción.

Se cierra la decisión pendiente de prácticas simultáneas: un alumno no puede
tener prácticas solapadas, incluso entre cursos A/B. B añadirá exclusión GiST
por alumno, bloques de 60 minutos e intervalos [inicio,fin), junto a la exclusión
existente por instructor. Preflight repetido, lock fuera de horario y lock_timeout.
La exclusión por alumno está en 025, con lock_timeout=5s y aplicación
fuera de horario; aborta ante solapamientos existentes, sin normalizar datos.

C actualiza la matrícula pendiente existente, sin otra matrícula ni prácticas
implícitas. Reutiliza candidatas, sugerencia, regla inclusiva y día civil del
Sprint 5; opciones limitadas al course_id exacto de la matrícula.
La regla de ventana vive solo en TypeScript; la RPC la hace cumplir comparando día y versión bajo lock, y solo service_role puede ejecutarla.
El backend pasa updated_at como texto exacto, incluidos sus microsegundos, sin
Date. La RPC toma locks alumno → matrícula → cohorte y después lee el día actual
de America/Guayaquil: si versión o día cambian devuelve 409 COHORT_CHANGED.
COHORT_WINDOW_CLOSED identifica una ventana ya cerrada al validar en TypeScript.
Una llamada directa de service_role debe respetar este contrato interno; el body
HTTP solo permite cohortId, nunca prueba de ventana ni actor suministrados por cliente.
Dentro de la transacción se comprueban rol estudiante, activo y el guard de D,
curso exacto, neto/abono NUMERIC y cupo con enforce_cohort_cupo (CD001). El guard
private.assert_student_not_deleting conserva CD030 → DELETION_PENDING, antes de
ACCOUNT_INACTIVE. Solo cambian cohorte, total neto, estado y los dos metadatos de
auditoría UUID/fecha en enrollments (sin FK, sin PII, eliminados junto con D).
Repetir la misma cohorte ya activa devuelve el resultado sin cambiar auditoría;
otra cohorte/estado devuelve ENROLLMENT_NOT_PENDING. No hay reasignación en C.
Errores adicionales: INVALID_FIELD (400), COHORT_COURSE_MISMATCH (400),
STUDENT_NOT_FOUND/ENROLLMENT_NOT_FOUND/COHORT_NOT_FOUND (404), ACCOUNT_INACTIVE
(403), DELETION_PENDING/COHORT_FULL/ABONO_EXCEEDS_NET (409). lock_timeout=5s;
deadlock/espera agotada con rollback confirmado → LOCK_CONFLICT (409); red/timeout
incierto → UNCONFIRMED (503), recargar sin reenvío automático ni compensaciones.
Rollback retira solo la RPC y conserva cohort_assigned_by/cohort_assigned_at y
sus valores. Ensayo secuencial local; último cupo entre dos admins queda como
prueba manual guiada en operations/estudiantes-c.md, sin simular concurrencia.

D permite eliminar alumnos activos o desactivados; no exige desactivación manual
previa. POST /admin/estudiantes/:id/eliminar inicia con { confirmacionCedula },
comparada exactamente contra el alumno del UUID antes de efectos. Persistir la
confirmación por fecha, sin cédula ni hash. No registrar el cuerpo en ningún log,
traza o error. B sigue independiente y reversible; D iniciada no se revierte.

Orden aprobado: bloqueo (activo=false + ban) → Storage → transacción de
datos/auditoría → Auth → completo. B debe cubrir middleware, rutas excepcionales
y Realtime: el ban no invalida JWT ya emitidos. Conservar las FKs actuales; Auth
se elimina después de las referencias RESTRICT y el perfil.

La misma petición POST, con cuerpo vacío, reanuda una operación confirmada
pendiente/fallida para cualquier admin autenticado y registra quién reintentó.
No inicia sin confirmación ni ejecuta de nuevo operaciones completas.
GET /admin/estudiantes/eliminaciones lista pendientes/fallidas paginadas, incluso
sin users, por UUID/estado/fase y actores/fechas, sin datos personales del alumno.
Declarar esa ruta estática antes de /:id.

Una única tabla mínima student_deletion_operations en 026, sin FK al perfil:
student_id como PK/Auth ID original, actor inicial, confirmed_at, fase, estado,
último actor/fecha/contador de reintentos y updated_at. La misma fila registra
data_deleted_by/data_deleted_at dentro de la transacción como auditoría mínima.
No guardar copias de identidad, payloads, rutas Storage ni hashes. Es necesaria
tras borrar users si Auth falla; manual_enrollment_operations es de matrícula
y se limpia en D, y student_profile_audit es inmutable y solo admite campos de
perfil. Reutilizarlas cambiaría contratos ajenos y no resuelve las fases de D.

Ejecutar por petición del admin, con botón de reintento y como máximo un reintento
automático transitorio dentro de esa petición, tras comprobar fase/resultado.
Sin ejecución periódica. Estados pendiente/fallido/completo; fases persistidas
y transiciones condicionales bajo locks evitan retrocesos por concurrencia.
Completo solo tras todos los pasos; una respuesta perdida no demuestra rollback.
Reusar la confirmación inicial sin guardar su valor aunque el perfil ya no exista.

Las rutas de Storage se consultan desde solicitud_documentos y solicitudes
ligadas exclusivamente por student_id. Limpiar objetos antes de borrar filas,
conservar las filas hasta confirmar Storage y releerlas en cada reintento.
Antes de la transacción, verificar que no quedaron rutas nuevas sin limpiar;
si cambian, no borrar filas y retomar Storage. Auth ID se obtiene del student_id
de la operación tras desaparecer el perfil; no duplicarlo en otra columna.

Bloqueos específicos de D solo en entradas admin de edición, reactivación y
creación de matrículas, incluida aprobación que matrícula. Guard común y control
de concurrencia en esos puntos; el resto se cubre con activo=false/ban y B.
Conservar controles actuales de solicitudes y probar escrituras ya en curso,
sin ampliar por defecto bloqueos D a subidas ni a todos los endpoints.

practice_slots es inventario del instructor/cohorte. D conserva las franjas
futuras: student_id=NULL, status=liberado y limpiar metadatos del alumno.
No existe estado libre. Política aprobada: borrar franjas ya iniciadas/
pasadas aún vinculadas al alumno (scheduled_at <= corte de servidor bajo locks).
Desvincular completado rompe el CHECK de alumno obligatorio; convertirlo en
sin_practica falsea la asistencia. Borrar evita nueva maquinaria, con el costo
de perder esa franja del historial del instructor. Eliminar recuperación B del
alumno; no tocar franjas ya liberadas y reservadas después por otra persona.

En la transacción: documentos de solicitudes antes de solicitudes; respuestas
antes de intentos; prácticas según lo anterior; checklist antes de matrículas;
operaciones manuales vinculadas; perfil al final. Reutilizar cascadas pertinentes.
Preservar exámenes/preguntas compartidos y registros ajenos; un RESTRICT inesperado
detiene el paso. Plan y diálogo: operations/estudiantes-d-plan.md.

El esquema real inspeccionado no tiene manual_enrollment_operations.request:
tiene request_hash/response. D repetirá inspección y limpiará la fila vinculada,
incluido request si aparece. No hay payments hoy; adaptar D cuando RF-04 exista.

## Consecuencias

No existe transacción global con Auth/Storage. Ban/eliminación no invalidan
retroactivamente JWT ni garantizan desconectar canales Realtime ya abiertos.
En D, la fase storage incluye limpieza de archivos y la transacción; esta última
confirma atómicamente la auditoría y la siguiente fase auth. No se persiste un manifiesto.
Guard previo a Auth y triggers acotados impiden edición/reactivación/matrícula
durante D (409 DELETION_PENDING); un unban en vuelo se cierra de nuevo al detectar D.
La garantía de recuperación de edición tras crash se reduce al adoptar A2 simple;
D conserva solo un registro mínimo para reanudación manual después de reinicios.

Aplicar SQL requiere aprobación del texto final, prueba aislada, respaldo
restaurable confirmado y ventana de ejecución; aprobar diseño no autoriza aplicar.
