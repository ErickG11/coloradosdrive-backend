# A1: listado y ficha de estudiantes

Solo lectura: GET /admin/estudiantes y GET /admin/estudiantes/:id, rol admin.
No incluye edición, auditoría nueva, operaciones, cifrado ni clave de recuperación.
Migración exacta: migrations/023_estudiantes_listado_ficha.sql, no aplicada.

## Contrato

GET listado: q (1–80 caracteres, nombre/cédula/teléfono), activo, courseId,
cohortId, pendienteCohorte, documentosPendientes, incluirHistorial, page y pageSize.
Booleanos true/false; página inicial 1, tamaño 20, máximo 100. Una fila por alumno,
total independiente de página, orden nombre/id y matchingEnrollments.
La vigencia se define en student_enrollment_is_current: activo/pendiente_cohorte.
Los filtros de matrícula coinciden en la misma matrícula. Activo filtra al
usuario independientemente. Sin filtros aparecen alumnos sin matrícula.
Historial optativo. Una RPC para listado, sin consulta a Auth por fila.

q es una subcadena literal, insensible a mayúsculas, sensible a acentos.
No usa pg_trgm/unaccent; los índices B-tree cubren orden/filtros, no subcadenas.
Para unos 200 usuarios no se justifica todavía otra extensión o índice GIN.

Ficha: perfil ampliado, correo leído una vez de Auth, historial, cursos,
cohortes, abono, saldo y checklist. Consultas por lotes, con el cálculo existente
compartido de ManualEnrollmentDetailsService. Sin cohorte, saldo/total nulos.
updatedAt se devuelve como string, con los microsegundos del JSON de PostgreSQL;
no se transforma en Date de JS. No hay operaciones de Auth ni de Storage.

## Revisión y aplicación

SQL de A1: cuatro índices y dos funciones, sin tablas ni modificaciones de datos.
Las funciones son SECURITY INVOKER y solo service_role puede ejecutarlas.
La lista exige actor admin; la ficha usa auth middleware/RBAC existentes.

Siempre DISABLE_CRON=true; no se inició servidor ni se aplicó SQL real.
Checks: lint, build, Jest/Supertest y npm run test:students-db.
El runner PGlite no carga .env ni abre conexiones; verifica BEGIN/ROLLBACK,
instalación/reversión, filtros, paginación, ACL y precisión de timestamps.
PGlite usa PostgreSQL 18.6; Supabase real es 17.6, pendiente prueba en esa versión.
Antes de aplicar: aprobar SQL exacto, confirmar respaldo restaurable y ejecutar
fuera de horario con lock_timeout=5s. Respaldo real no confirmado.
Reversión: estudiantes-a1-rollback.sql. Sin DROP CASCADE; dependencias posteriores
impedirán una reversión insegura.

Chore cron: 57ff189. La rama de A1 lo incorpora como prerrequisito, main intacto.
El commit original 3a5b05e queda preservado en archive/estudiantes-a-original.
La edición A2 está propuesta por separado en estudiantes-a2-propuesta.md.
# Revisión A1

Si Auth no está disponible, la ficha conserva los datos académicos y devuelve
`correo: null, correoDisponible: false`. Los errores de esquema devuelven un
503 genérico; el diagnóstico queda en el log sin valores personales.

