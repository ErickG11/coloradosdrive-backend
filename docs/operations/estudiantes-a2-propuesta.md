# A2: edición simple de estudiantes

Implementada en `feat/estudiantes-edicion`, pendiente de aprobación de 024.
Ticket sugerido: «Backend: edición administrativa de estudiantes y auditoría mínima».
No se aplicó SQL al proyecto real ni se inició el servidor.

## Contrato

PATCH /admin/estudiantes/:id, authenticate + requireRole('admin').
Enviar `updatedAt` exactamente como string recibido en GET de la ficha, sin Date;
y uno o más de cedula, nombreCompleto, telefono, fechaNacimiento, tipoSangre,
genero, ciudadania, direccion, correo. Rechazar otros campos (rol/activo/status).
Los campos opcionales de perfil admiten null; cédula/nombre/correo no.
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

Después de Auth, rechazo SQL confirmado: revertir correo una sola vez, registrar
el resultado sin valores; una compensación fallida requiere revisión administrativa.
Fallo de red/timeout de RPC: consultar student_profile_audit por operation_id.
Si existe para el alumno/actor, no compensar y devolver éxito con
updatedAt:null, refreshRequired:true: el cliente debe volver a consultar la ficha.
Si no existe, compensar una vez según la política aprobada. Si la propia consulta
falla, devolver 503 incierto y no compensar. No se reintenta la RPC automáticamente.

## Límites concretos (sin maquinaria adicional)

Una consulta vacía puede adelantarse al commit de una RPC aún en ejecución.
En ese caso, compensar puede dejar Auth revertido y una auditoría de cambio confirmado.
Un crash después de Auth y antes de SQL deja el cambio solo en Auth, rastreable por el log previo.
Dos administradores cambiando correo pueden competir; updated_at no hace CAS sobre Auth.
Resolver automáticamente esas carreras requiere un fence/serialización durable; no se añadió.

## Validación y despliegue pendiente

Build, lint, Jest y prueba PostgreSQL aislada con DISABLE_CRON=true.
Resultado de revisión: 41 suites / 531 pruebas Jest aprobadas; build y lint sin
errores; pruebas SQL aisladas A1 y A2 aprobadas. Advertencia existente de ts-jest
sobre isolatedModules, sin cambios en esta entrega.
`node tests/database/studentProfile.mjs` prueba 024 con BEGIN/ROLLBACK,
perfil/auditoría atómicos (incluido fallo de INSERT después del UPDATE), no-op,
unicidad, versión exacta con microsegundos y permisos anon/authenticated.
PGlite usa PostgreSQL 18.6 y un esquema recreado; el proyecto real es PostgreSQL
17.6. No equivale a prueba en rama real ni valida carreras entre sesiones HTTP.

SQL exacto: migrations/024_estudiantes_edicion.sql. Antes de aplicar:
OK explícito sobre SQL final, repetir preflight de esquema/trigger y confirmar
respaldo restaurable. El respaldo aún no está confirmado. La reversión posterior
debe conservar auditoría: retirar RPC/endpoint, sin borrar student_profile_audit.
