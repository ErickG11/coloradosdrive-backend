# ADR 013: Administración y eliminación de estudiantes

## Estado

Diseño aprobado en dirección; A1 y A2 implementadas para revisión en sus ramas.
Migraciones 023 y 024 aplicadas al proyecto real con aprobación explícita.
B (acceso/reservas), C (asignación de cohorte) y D (eliminación) pendientes.
Revisión D: eliminación sin desactivación previa y confirmación por cédula;
plan actualizado, orden técnico pendiente de OK antes de implementar.

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

B bloqueará acceso del alumno inactivo o sin perfil, incluidas rutas excepcionales
y autorizaciones Realtime, combinando activo y ban en Auth. Desactivación:
cancelar solo reservas futuras con motivo trazable, conservar matrícula, cupo,
abono, prácticas pasadas y asistencia. Reactivación: acceso primero y recuperación
individual por la lógica existente; conflictos pendientes de reprogramar.

Se cierra la decisión pendiente de prácticas simultáneas: un alumno no puede
tener prácticas solapadas, incluso entre cursos A/B. B añadirá exclusión GiST
por alumno, bloques de 60 minutos e intervalos [inicio,fin), junto a la exclusión
existente por instructor. Preflight repetido, lock fuera de horario y lock_timeout.
Esta restricción no se aplica en A1 ni A2.

C asignará cohorte actualizando la matrícula pendiente: validar curso, ventana,
cupo y abono <= neto bajo locks, sin crear otra matrícula ni prácticas implícitas.

D admitirá eliminación definitiva en una sola acción admin, esté activo o
desactivado el alumno. No exige ejecutar B antes. Confirmación inicial explícita
en el cuerpo mediante cédula exacta, verificada por el servidor contra el alumno
del UUID de la ruta antes de cualquier efecto. No guardar cédula, nombre, correo,
valores ni hashes de confirmación en auditoría/logs/operación; no ponerlos en URL.
B conserva su acción independiente y reversible. D es irreversible y no se
compensa reactivando una cuenta cuyo borrado empezó.

Persistir una única operación y el manifiesto Storage/Auth antes de eliminar.
El primer paso efectivo es bloquear acceso: activo=false y ban en Auth; ambos
deben estar confirmados antes de borrar archivos/datos. B debe asegurar también
middleware, rutas excepcionales y Realtime; un ban no invalida por sí solo JWT
ya emitidos. Mientras D está pendiente/fallido se impiden reactivación y nuevas
escrituras asociadas, incluida edición de identidad y subida de documentos.

El orden solicitado Storage → Auth → transacción de datos no es ejecutable con
las FKs actuales: users.id → auth.users ON DELETE CASCADE, con RESTRICT desde
enrollments, exam_attempts, practice_slots y solicitudes_inscripcion a users.
Eliminar Auth antes falla por RESTRICT o elimina el perfil fuera de la RPC final.
Propuesta mínima PENDIENTE de aprobación: bloqueo → Storage → transacción
datos/auditoría → Auth → completo. Mantener Auth antes de la transacción exigiría
rediseñar la FK Auth/perfil, con impacto transversal; no queda decidido ni autorizado.

Operación persistente con estados pendiente/completo/fallido y fase confirmada;
pasos idempotentes y reintento manual sobre la misma operación, incluso tras
reinicio. Propuesta pendiente: confirmar cédula al iniciar y reutilizar esa
confirmación al reintentar la operación ya autorizada (sin conservar su valor).
Es necesario si el perfil se borró y Auth falló: ya no queda cédula que comparar.
No interpretar la ausencia del perfil como que todo terminó. Completo solo tras
confirmar todos los pasos. Trabajador desactivado por defecto en tests/local,
bajo DISABLE_CRON o flag propio. Purgar rutas temporales al completar; auditoría
final solo actor, fecha e identificador, sin datos personales del alumno.

Solicitudes exclusivamente ligadas por student_id/FK, no por cédula/correo.
Borrar sus objetos Storage antes de perder las rutas; en la transacción, borrar
documentos de solicitudes antes de solicitudes, respuestas antes de intentos,
prácticas, checklist antes de matrículas y el perfil al final. Limpiar operaciones
de matrícula manual ligadas explícitamente. Preservar exámenes/preguntas
compartidos y registros de otras personas. Una FK no contemplada detiene el paso.
Plan y diálogo aprobado por el solicitante: operations/estudiantes-d-plan.md.

El esquema real inspeccionado no tiene manual_enrollment_operations.request:
tiene request_hash/response. D repetirá inspección y limpiará la fila vinculada,
incluido request si aparece. No hay payments hoy; adaptar D cuando RF-04 exista.

## Consecuencias

No existe transacción global con Auth/Storage. Ban/eliminación no invalidan
retroactivamente JWT ni garantizan desconectar canales Realtime ya abiertos.
La garantía de recuperación de edición tras crash se reduce al adoptar A2 simple;
el trabajador de borrado D conserva persistencia por su alcance distinto.

Aplicar SQL requiere aprobación del texto final, prueba aislada, respaldo
restaurable confirmado y ventana de ejecución; aprobar diseño no autoriza aplicar.
