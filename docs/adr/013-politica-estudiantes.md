# ADR 013: Administración y eliminación de estudiantes

## Estado

Diseño aprobado en dirección; refinado el 14/10/2026. A1 implementada para
revisión, migración 023 no aplicada. A2 propuesta, no implementada.
B (acceso/reservas), C (asignación de cohorte) y D (eliminación) pendientes.

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

A2 se propone simple: una transacción UPDATE + auditoría de nombres de campos,
actor, fecha e identificador, sin valores/hashes. Validación de cédula y unicidad
antes de Auth; constraint única conserva protección concurrente. Correo solo
en Auth, actualizado primero, una compensación ante rechazo SQL confirmado.
Sin operaciones persistentes, tokens, cifrado ni clave de recuperación. Los
crashes y respuestas inciertas requieren revisión manual; no revertir un commit
posiblemente confirmado. Detalle: operations/estudiantes-a2-propuesta.md.

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

D admitirá borrado solo de alumnos desactivados. Borrados explícitos en RPC,
auditoría mínima y manifiesto Storage/Auth antes de borrar; trabajador persistente
e idempotente, desactivado en tests/local y bajo DISABLE_CRON o flag propio.
Completo solo tras limpiar APIs externas; pendiente/fallido y reintento manual.
Solicitudes exclusivamente por FK, no por cédula/correo. Borrar intentos y
respuestas, conservar exámenes/preguntas compartidos. Mantener auditoría mínima.

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
