# Ficha de Alumnos: horario y requisitos

Rama: feat/estudiantes-ficha-horario-requisitos, sobre feat/estudiantes-busqueda-mejorada.

## Lectura y despliegue

Se amplía GET /admin/estudiantes/:id. La ficha utiliza una sola petición HTTP al abrir y vuelve a consultar ese mismo endpoint después de editar, cambiar acceso o asignar cohorte. El endpoint anterior de reservas-pendientes permanece disponible para compatibilidad; esta pantalla ya no lo solicita.

No hace falta una RPC ni migración 029: usa las tablas existentes con el cliente administrativo del backend. No se cambian tablas, RLS ni permisos. El endpoint conserva authenticate y requireRole(admin). Ningún dato nuevo permite escritura desde el horario.

Las consultas son por lote: perfil y matrículas; después documentos, cursos, cohortes, definitivos publicados, intentos propios, franjas propias y recuperaciones propias; finalmente nombres de todos los instructores en una consulta. Máximo diez consultas a tablas, independiente del número de filas, más una lectura de Auth para correo. Correo y matrículas se consultan en paralelo; los siete lotes siguientes también. No hay consultas por alumno, examen o franja. El correo conserva la degradación a No disponible si Auth falla; un error de las consultas de requisitos/horario produce 503 y permite reintentar, sin presentar datos falsamente completos.

Desplegar backend antes de frontend, porque graduation y practiceSchedule son campos requeridos del contrato. Conservar el mismo esquema 001–028. No hay SQL para ejecutar.

## Cálculos

Se evalúan cinco categorías por matrícula vigente (activo o pendiente_cohorte). Faltan N requisitos suma categorías pendientes por matrícula, sin mezclar saldo ni horas entre cursos. Las matrículas finalizadas y retiradas conservan sus datos en el historial de matrículas; no generan pendientes nuevos. Sin matrícula vigente se informa que no hay requisitos evaluables, en lugar de declarar todo cumplido.

- Cohorte: cohort_id presente. La acción existente de asignación se muestra en el encabezado para pendiente_cohorte y conserva todos los bloqueos de A–D.
- Pagos: saldo = total neto menos abono acumulado, redondeado a centavos. Cumplido exige saldo cero; un precio aún desconocido queda pendiente con el abono disponible. No se inventa historial de pagos ni vencimientos, ni se afirma mora.
- Práctica: suma duration_minutes exclusivamente cuando status=completado y attended=true, por alumno y cohorte. Comparación exacta de minutos frente a horas_practica_objetivo*60; se muestran horas con hasta dos decimales. Objetivo NULL queda pendiente y no se sustituye por horas_requeridas del curso. El cálculo usa todas las prácticas aunque el historial visible se limite a diez.
- Exámenes: cuenta definitivos publicados del curso y los que tienen intento propio completado y aprobado. Intentos repetidos no duplican aprobaciones. Sin definitivos publicados queda pendiente. El modelo vincula los intentos por alumno/curso, no por matrícula: no permite distinguir rematrículas del mismo curso.
- Documentos: cuatro tipos del checklist existente; entregado y no_aplica cumplen. Una fila ausente también aparece en la lista de faltantes.

Los pendientes aparecen antes que los cumplidos y se destacan. El encabezado muestra contacto, cuenta y matrículas vigentes; datos personales y matrículas históricas quedan después del horario.

## Horario y privacidad

- Próximas: franjas propias futuras asignadas o confirmadas, ordenadas por fecha e ID; nombres Reservada y Confirmada.
- Recuperaciones: snapshots conservados por desactivación, incluso si están en el pasado. Cancelada por desactivación se muestra Liberada; conflicto de recuperación, Pendiente de reprogramar. No se duplican snapshots cuya reserva ya está vigente con la misma fecha, instructor y cohorte.
- Historial: últimas diez franjas propias, en orden descendente, cerrado por defecto; incluye asistencia registrada, ausencia o asistencia sin registrar.
- Hora explícita de America/Guayaquil, independiente de la zona del navegador.
- Solo se devuelve el nombre del instructor; no su cédula, teléfono, correo ni perfil. No se devuelven preguntas, respuestas o notas de exámenes.

Limitación del esquema: al liberar normalmente una franja se borra student_id. Sin un snapshot de student_practice_recovery no puede atribuirse esa liberación histórica a un alumno. Se muestran exclusivamente registros demostrables; no se consulta ni atribuye la reserva actual de otra persona. En los snapshots no existe duración: no se inventa una hora de práctica.

## Alumno ficticio incluido

Las pruebas incorporan un alumno con total $100, abono $30, saldo $70; objetivo diez horas, seis franjas de sesenta minutos completadas y asistidas; un definitivo aprobado de dos; cédula pendiente y los otros tres documentos entregados. Resultado esperado: Faltan 4 requisitos (pagos, práctica, exámenes y documentos); cohorte cumplida. Incluye reserva futura, confirmación futura, snapshot liberado y recuperación pendiente.

Fixture visual: frontend/tests/fixtures/studentGraduation.ts. Pruebas de cálculo y de servicio: backend/tests/unit/studentGraduation.test.ts y studentAdmin.service.test.ts. Son datos sintéticos en pruebas, no un alumno creado en Supabase.

## Prueba manual en cinco pasos

1. En un entorno de pruebas, seleccionar o preparar mediante los módulos existentes un alumno descartable con los valores anteriores (total $100, abono $30, cohorte, objetivo diez horas, seis horas asistidas, un definitivo aprobado de dos y cédula pendiente). Conservar dos prácticas futuras: una reservada y otra confirmada. No usar datos reales.
2. Abrir su ficha como admin. Verificar contacto, cuenta, curso/cohorte y Faltan 4 requisitos: saldo $70, 6 de 10 horas, 1 de 2 aprobados y cédula faltante. En Red debe existir una sola lectura GET /admin/estudiantes/:id y ninguna de reservas-pendientes.
3. Revisar próximas prácticas, hora de Ecuador e instructor. Abrir Historial reciente y contrastar asistencia. No debe haber botones para crear, mover o reservar prácticas.
4. Desactivar/reactivar al alumno mediante las acciones existentes. Confirmar recarga de la ficha y que las reservas recuperadas no se dupliquen; ante un conflicto, ver Liberada o Pendiente de reprogramar con explicación. Abrir también un alumno sin cohorte y probar el botón existente de asignación.
5. Editar un dato y comprobar guardado y bloqueo optimista con dos pestañas. Verificar que acceso, asignación y eliminación quedan bloqueados cuando corresponde; probar eliminación exclusivamente con el alumno descartable y comprobar la lista de eliminaciones pendientes.


## Validación final (2026-10-16)

Backend: 48 suites, 688 pruebas aprobadas; lint y build aprobados. Frontend: 47 archivos, 354 pruebas aprobadas; lint, TypeScript y build de producción con Webpack aprobados. Las cinco pruebas SQL existentes de Alumnos (listado/028, edición, acceso, eliminación y cohorte) pasaron en memoria sin red. No se ejecutó SQL contra Supabase ni se crearon usuarios reales. La comprobación manual descrita arriba queda para el entorno de pruebas del responsable.

## Archivos cambiados

Backend:
- src/services/studentAdmin.service.ts
- src/services/studentGraduation.ts
- tests/integration/studentAdmin.test.ts
- tests/unit/studentAdmin.service.test.ts
- tests/unit/studentGraduation.test.ts
- docs/operations/estudiantes-ficha-horario-requisitos.md

Frontend:
- app/(admin)/admin/students/StudentDetail.tsx
- app/(admin)/admin/students/StudentGraduation.tsx
- app/(admin)/admin/students/StudentSchedule.tsx
- app/(admin)/admin/students/StudentReservations.tsx
- types/student.ts
- tests/app/(admin)/admin/students/StudentGraduation.test.tsx
- tests/app/(admin)/admin/students/students.test.tsx
- tests/fixtures/studentGraduation.ts
- tests/fixtures/studentProfile.ts
- docs/estudiantes-ficha-horario-requisitos.md
