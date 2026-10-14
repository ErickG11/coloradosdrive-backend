# A2: edición simple de estudiantes

Implementada en `feat/estudiantes-edicion`; contenido de 024 aprobado, aplicación
retenida hasta el dry-run con rollback y respaldo a cargo del responsable.
Ticket sugerido: «Backend: edición administrativa de estudiantes y auditoría mínima».
No se aplicó SQL al proyecto real ni se inició el servidor.

## Contrato

PATCH /admin/estudiantes/:id, authenticate + requireRole('admin').
Enviar `updatedAt` exactamente como string recibido en GET de la ficha, sin Date;
y uno o más de cedula, nombreCompleto, telefono, fechaNacimiento, tipoSangre,
genero, ciudadania, direccion, correo. Rechazar otros campos (rol/activo/status).
Los campos opcionales de perfil admiten null; cédula/nombre/correo no.
Las rutas validan fechaNacimiento como fecha real YYYY-MM-DD (año 0001–9999),
updatedAt como timestamp ISO real con zona y hasta seis decimales. Teléfono:
máximo 20 caracteres; dirección, tipo de sangre, género y ciudadanía: máximo
500 cada uno (límites conservados del contrato A2). Fallos de entrada: 400 antes
de consultar o actualizar Auth/SQL.
Cédula se valida con el algoritmo ecuatoriano reutilizado, y su unicidad en todos
los users, excluyendo al alumno, antes de cualquier actualización de Auth.
La UNIQUE existente protege también carreras posteriores a la preconsulta.

## Guardado

El backend genera operation_id con crypto.randomUUID antes del guardado.
Una sola RPC guarda el perfil con UPDATE y la auditoría en la misma transacción.
Bloquea la fila y comprueba updated_at; una versión obsoleta devuelve 409.
El trigger real users_set_updated_at, BEFORE UPDATE, usa now() con precisión 6.
SELECT/PostgREST y la RPC transportan el string exacto sin convertirlo a Date.

Auditoría: operation_id, actor_id, student_id, created_at, changed_fields.
Sin valores, hashes de cédula/correo, cifrado ni STUDENT_RECOVERY_KEY.
Sin FKs a usuarios para sobrevivir al borrado D. RLS habilitado, acceso solo
service_role, sin permisos UPDATE/DELETE para ese rol. Las ediciones sin cambios
no generan auditoría de un cambio inexistente.

Correo reside únicamente en Auth. Antes de updateUserById se registra una línea
JSON con student_id, operation_id, campo: correo; sin valores. Se confirma el
correo mediante email_confirm:true, sin envío de avisos. Rechazo explícito de
Auth: no llamar a SQL ni compensar. Fallo de transporte de Auth: 503 incierto,
sin una segunda mutación a ciegas.

Después de Auth, compensar una sola vez exclusivamente ante rechazos definitivos
RPC: 23505, CD409, 22023 y CD404. Registrar el resultado sin valores. Una
compensación fallida requiere revisión administrativa. En 23505 se extrae solo
el nombre de restricción del message de PostgREST: users_cedula_unique es cédula
duplicada; student_profile_audit_pkey es conflicto del identificador de guardado.
No registrar message/details, que pueden incluir valores personales.
Timeout/red u otro error RPC: responder 503 con «Revisar manualmente», log con
student_id/operation_id/código, sin compensación ni consulta de auditoría para
decidir. No se reintenta la RPC automáticamente.
Se elimina el índice de alumno/fecha: A2 no expone consultas de historial de
auditoría. La PK de operation_id basta para su integridad.

## Límites concretos (sin maquinaria adicional)

Una RPC con respuesta perdida puede haber confirmado o seguir ejecutándose.
No se compensa ante esa incertidumbre: el admin debe revisar Auth y datos manualmente.
Un crash después de Auth y antes de SQL deja el cambio solo en Auth, rastreable por el log previo.
Dos administradores cambiando correo pueden competir; updated_at no hace CAS sobre Auth.
Resolver automáticamente esas carreras requiere un fence/serialización durable; no se añadió.

## Validación y despliegue pendiente

Build, lint, Jest y prueba PostgreSQL aislada con DISABLE_CRON=true.
Revisión posterior: build/lint aprobados, 41 suites / 555 pruebas Jest aprobadas;
migración y reversión operativa verificadas exclusivamente en PostgreSQL aislado.
`node tests/database/studentProfile.mjs` prueba 024 con BEGIN/ROLLBACK,
perfil/auditoría atómicos (incluido fallo de INSERT después del UPDATE), no-op,
unicidad, versión exacta con microsegundos y permisos anon/authenticated.
También prueba el script docs/operations/estudiantes-a2-rollback.sql: retira RPC
y permiso INSERT de service_role, conservando tabla, auditoría y permiso SELECT.
PGlite usa PostgreSQL 18.6 y un esquema recreado; el proyecto real es PostgreSQL
17.6. No equivale a prueba en rama real ni valida carreras entre sesiones HTTP.

SQL exacto: migrations/024_estudiantes_edicion.sql. Antes de aplicar:
El responsable hará dry-run con rollback y respaldo; no aplicar aún. Repetir el
preflight de esquema/trigger antes de una aplicación autorizada. La reversión
operativa conserva auditoría: retirar endpoint y ejecutar el script de reversión,
sin borrar student_profile_audit ni intentar restaurar valores de perfil.
Al conservar la tabla, 024 no se puede reejecutar íntegra tras esa reversión:
para restablecer A2 hace falta restaurar RPC y permiso INSERT con SQL revisado.
