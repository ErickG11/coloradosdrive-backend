# Alumnos: búsqueda mejorada / 028

Rama: feat/estudiantes-busqueda-mejorada, sobre feat/estudiantes-asignacion-cohorte.
SQL pendiente para Erick. No se ha aplicado en Supabase ni en una base persistente.
No requiere cambios en el endpoint ni llamadas adicionales por alumno.

## Aplicación manual

1. Ejecutar estudiantes-busqueda-preflight.sql y confirmar el esquema esperado de 001–027, encoding UTF8 y los permisos actuales.
2. Conservar la definición de la RPC y los resultados de RLS/permisos. Revisar 028_estudiantes_busqueda_mejorada.sql.
3. Erick ejecuta migrations/028_estudiantes_busqueda_mejorada.sql con el rol de migraciones. Incluye transacción, lock_timeout y recarga de PostgREST.
4. Repetir el preflight: solo service_role puede ejecutar las tres funciones; SECURITY INVOKER y políticas RLS intactas.
5. Publicar el frontend cuando esté disponible la 028. Para revertir, ejecutar estudiantes-busqueda-rollback.sql: restaura exactamente la RPC de 023 y elimina los dos helpers.

## Criterios del resumen

Se evalúan cinco categorías sobre todas las matrículas coincidentes (incluido historial si se solicita). Una categoría pendiente en cualquiera de ellas cuenta una vez por alumno. Sin matrículas se informa sin verificar; no se declara completo.

- Cohorte: todas las matrículas tienen cohorte.
- Documentos: los cuatro tipos del checklist existen y están entregados o no_aplica. Filas ausentes se consideran pendientes.
- Pagos: un saldo cero permite confirmar el requisito. Un saldo pendiente o precio desconocido se informa sin verificar: no existe calendario de vencimientos para determinar mora. No se suman pagos de otra fuente ni se inventan cuotas.
- Exámenes: debe existir al menos un definitivo publicado del curso; todos los definitivos publicados requieren intento completado y aprobado. Borradores y exámenes de práctica no cuentan. Los intentos se vinculan por alumno y curso; el esquema no registra enrollment_id en exam_attempts y no permite distinguir intentos entre rematrículas del mismo curso. Sin definitivo publicado se considera pendiente.
- Prácticas: suma de minutos de franjas completadas con attended=true, para ese alumno y cohorte, frente a horas_practica_objetivo*60. No se cuentan reservas, ausencias ni horarios de otra cohorte. Objetivo NULL se informa sin verificar; no se sustituye por courses.horas_requeridas.

La tabla permite desplegar el detalle de pendientes y datos no verificables. Completo exige las cinco categorías verificadas.

## Conteos y búsqueda

activeStudents: alumnos distintos con cuenta activa y matrícula activa en la cohorte, independiente de TODOS los filtros de la lista, la búsqueda y la paginación.
usedCapacity: matrículas activas de la cohorte, idéntico al criterio de enforce_cohort_cupo; una cuenta desactivada puede seguir ocupando cupo.
matchingActiveStudents: subconjunto de activeStudents que coincide con los filtros actuales; se usa para Mostrando M de N alumnos activos, evitando M>N al consultar desactivados o historial. El pie de tabla conserva el total de resultados de cualquier estado.

Búsqueda literal, sin comodines SQL: normalización Unicode NFD, elimina marcas combinadas e ignora mayúsculas. Sin extensiones ni índices adicionales para ~200 usuarios. La búsqueda se envía solo al endpoint y no se guarda en URLs de navegación.

## Validación

Se amplió tests/database/students.mjs, existente: PostgreSQL en memoria sin red ni persistencia. Comprueba 028, rollback y reaplicación, ACL, tildes compuestas/descompuestas, comodines literales, búsqueda por teléfono/cédula, conteo sin resultados y cuentas desactivadas, documentos faltantes, exámenes, ausencia/asistencia y objetivo desconocido. También se comprueba la propagación del contrato en el servicio.


## Resultado final (2026-10-16)

- Backend: 47 suites, 677 pruebas aprobadas; npm run build y npm run lint aprobados.
- Frontend: 46 archivos, 348 pruebas aprobadas; lint y build de producción con npm run build -- --webpack aprobados.
- Las cinco pruebas SQL existentes de Alumnos (listado + 028, edición, acceso, eliminación y cohorte) aprobadas en memoria. No se accedió a Supabase ni se aplicó la 028 en una base persistente.
- Turbopack no admite el enlace de node_modules utilizado para compartir dependencias entre worktrees; se validó con Webpack sin cambiar la configuración del proyecto.
- Se corrigieron exportaciones auxiliares preexistentes de page.tsx en Alumnos y Eliminaciones, rechazadas por el chequeo de tipos de Next. No se alteró su comportamiento.

## Prueba manual en cinco pasos (después de que Erick ejecute la 028)

1. Entrar como admin, abrir Alumnos y escribir un nombre sin tildes/en mayúsculas, una cédula y un fragmento del teléfono. Confirmar búsqueda automática tras 350 ms y mensaje de carga.
2. Seleccionar Curso y revisar que Cohorte solo ofrece sus cohortes. Cambiar a otro curso y confirmar que se elimina la cohorte incompatible.
3. Elegir cohorte, anotar alumnos activos y cupos, pasar de página y buscar un nombre: N y cupos permanecen constantes, M corresponde al subconjunto de alumnos activos que coincide.
4. Desplegar Requisitos de un alumno y contrastar documentos, saldo, definitivos publicados y prácticas asistidas. Probar una búsqueda sin coincidencias y Limpiar filtros; deben desaparecer búsqueda/filtros y volver a página 1.
5. Abrir una ficha y comprobar edición, desactivar/reactivar y asignación de cohorte. Probar eliminación exclusivamente con un alumno descartable, incluida la lista de eliminaciones pendientes.
