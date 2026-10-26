# Asistencia E1: cancelación con motivo

Rama `feat/asistencia-cancelacion`, creada desde `main` (`6f520c5`). Esa base ya contiene
019–029, incluidos acceso, eliminación y asignación de cohorte de Estudiantes.
Se usa **030_asistencia_cancelacion.sql** porque 028 y 029 ya están ocupadas.
No se modifican migraciones históricas. SQL preparado para aplicación manual;
no aplicado en Supabase ni desplegado. El acceso a la base real fue denegado
durante la auditoría previa; no se presume que el esquema remoto coincida con Git.

## Decisiones

- Una RPC nueva, `cancel_practice_slot_with_reason`, mantiene obligatorio el motivo
  sin sobrecargar la firma de claim/confirm. Se rechaza `cancel` en la RPC antigua
  y en su helper privado. El UUID del alumno sale del JWT en el controlador.
- Orden de bloqueo: perfil activo compartido, matrícula exclusiva y franja exclusiva.
  Dos cancelaciones de la matrícula se serializan antes de leer/modificar su contador.
  El reclamo HTTP toma primero un bloqueo compartido de matrícula para conservar ese orden.
  Se relee propietario/estado y se comprueba el inicio con reloj PostgreSQL después de esperar.
- `practice_plan.fechaFinElegida` es el límite civil elegido al matricularse;
  `practice_plan.modalidad` contiene `entre_semana` o `fin_de_semana`.
  Lo escribe `ManualEnrollmentService.confirm` mediante `storedPlan` y
  `commit_manual_enrollment` de 022. No se deduce desde `cohorts.tipo_modalidad`
  ni desde la última franja. Un plan ausente o inválido produce 409 sin cancelar.
- `private.eligible_free_slots_for_enrollment(enrollment_id, excluded_slot_id)` se
  reutiliza en vista previa y cancelación. Considera cohorte, plan, cuentas activas,
  60 minutos y cruces de alumno incluso entre cursos. Excluye franjas ya cerradas
  para reclamar a T−5, según el límite vigente de `practice_slot_window_open`.
  Ignora la práctica que se suelta al calcular los cruces. No reserva una alternativa.
- Categorías: `salud`, `trabajo`, `estudios`, `familiar`, `transporte`, `otro`.
  El texto se recorta y requiere al menos 10 caracteres en HTTP y SQL.
- Historial con IDs y hora originales: `slot_id`, alumno, instructor y cohorte son
  instantáneas sin FK, porque una franja se reutiliza y puede desaparecer.
  `enrollment_id` sí tiene FK RESTRICT: el borrado definitivo elimina primero el
  historial y después la matrícula. No se cambia el protocolo de eliminación,
  sus guards ni su auditoría. RLS habilitado; solo service_role recibe
  SELECT/INSERT/DELETE. No hay permiso UPDATE ni políticas/grants para clientes.
- `reprogramable` incrementa de 0 a 1 o de 1 a 2; `hora_perdida` y `falta` no incrementan.
  `falta` aquí es resultado de cancelación, no un nuevo estado de asistencia.
  Cancelar a T−5 exacto o después deja `sin_practica` y avisa solo al instructor.
  Antes de ese límite deja `liberado` y difunde a la cohorte después del commit.
- El scheduler solo cierra `liberado`. Una práctica `asignado` sin respuesta se
  conserva y puede terminar, igual que `confirmado`, después de sus 60 minutos;
  `attended` permanece sin registrar. Los correos explican que confirmar es opcional;
  se conserva su conversión horaria existente, fuera del alcance E1.
- Se mantienen RPC `SECURITY INVOKER`, search_path vacío y permisos explícitos;
  [guía de funciones de Supabase](https://supabase.com/docs/guides/database/functions).

## Contrato HTTP

Solo estudiante autenticado y dueño. `GET /practice-slots/:id/cancel-preview` no
escribe ni notifica. Devuelve `reprogramacionesRestantes`, `hayFranjasLibres` y
`resultadoSiCancela`. Es una fotografía informativa; POST vuelve a evaluar todo.

`POST /practice-slots/:id/cancel` exige `motivoCategoria` y `motivoTexto`.
Conserva los campos de PracticeSlot en la respuesta y agrega `cancelacion`:
`cancellationId`, `enrollmentId`, `cancelledAt`, `resultado`,
`consumioReprogramacion`, `reprogramacionNumero` y `reprogramacionesRestantes`.
Una cancelación repetida sobre la franja ya liberada devuelve 404 sin nuevo consumo.
No se aceptan `studentId`, contador ni hora del cliente como autoridad.

## Aplicación manual y reversión

1. Revisar `asistencia-a-preflight.sql` en SQL Editor. Es solo lectura y termina
   en ROLLBACK. Resolver los planes ausentes/incorrectos y prácticas sin matrícula
   activa con el responsable; este lote no los rellena automáticamente.
2. Coordinar una ventana breve para migración y backend: el frontend actual aún
   no envía el motivo obligatorio. La integración visual corresponde a otra entrega.
3. Aplicar manualmente `migrations/030_asistencia_cancelacion.sql` una sola vez,
   tras verificar las dependencias 019–029. No ejecutar archivos 001–029 de nuevo.
4. Ejecutar completo `asistencia-a-verificacion.sql`. Crea exclusivamente fixtures
   nuevos y termina en ROLLBACK, sin invocar correo, Broadcast ni API Auth.
   Si falla, ejecutar ROLLBACK en esa sesión. La forma real de auth.users y sus
   posibles triggers externos debe ser revisada por quien lo ejecute.
5. Desplegar el backend E1 coordinadamente; comprobar `DISABLE_CRON` en el entorno.
   El interruptor sigue controlando ambos crons, sin cambios en esta entrega.

`asistencia-a-rollback.sql` restaura exactamente las funciones previas y retira
los objetos nuevos solo si no hay historial ni contador consumido. Si ya hay datos
E1, se detiene: exportar y decidir con el responsable antes de revertir; no elimina
cancelaciones confirmadas ni reconstruye reservas. Coordinar también el backend anterior.

## Verificación y límites

Verificación local sin red: `npm run build`, `npm run lint`, Jest y
`DISABLE_CRON=true npm run test:practice-cancellation-db` / `test:student-deletion-db`.
En PowerShell: `$env:DISABLE_CRON='true'`; después ejecutar el script npm correspondiente.

Resultados locales en Node 22.20.0: build y lint aprobados; Jest **904 pruebas /
53 suites aprobadas**. Ambos scripts de BD aprobaron en PGlite 0.5.10 (PostgreSQL
18.6 en memoria). Jest conserva su advertencia previa TS151002; no se cambia su
configuración para ocultarla.

El ensayo PGlite aplica el historial versionado en memoria, prueba el dry-run de 030,
su rollback exacto y protegido, preflight, los tres resultados, planes inválidos,
elegibilidad, cuenta inactiva, propiedad, límites de tiempo, silencio y permisos.
El ensayo de eliminación comprueba que un fallo revierte también el borrado del
historial y que el borrado exitoso conserva la auditoría de eliminación.
Jest verifica rutas, validaciones y avisos posteriores al commit con RPC simuladas.

Ni Jest ni PGlite ni el SQL de una sola sesión demuestran bloqueos reales entre
dos conexiones concurrentes. El SQL reproduce el resultado serial requerido:
con un cambio restante, dos cancelaciones dejan un `reprogramable`, un `falta` y
contador 2. Queda pendiente validar esperas, tiempos y carreras en PostgreSQL
remoto o en un entorno desechable de varias conexiones antes de dar E1 por desplegada.

La disponibilidad no queda reservada por la vista previa ni por cancelar; puede
cambiar después. E2 implementará la reserva de la hora pendiente y el intercambio
por un cupo liberado sin volver a cobrar la cancelación ya contada. Los avisos
siguen siendo best-effort: si falla SMTP/Broadcast tras el commit, el dato permanece
cancelado y el error se registra. No se agrega cola ni bandeja persistente en E1.
El contador de las matrículas existentes comienza en cero según el DEFAULT de
E1: las cancelaciones antiguas no tenían historial suficiente para reconstruirlo.

## Propósito de cada pieza, en lenguaje simple

La corrección de T−5 evita quitarle su práctica a un alumno que no respondió.
Solo se cierra el cupo cancelado que nadie tomó; el instructor recibe el aviso.

La tabla de historial permite saber quién canceló, qué práctica tenía, cuándo lo
hizo, por qué y si conserva derecho a recuperar la hora.

El contador guarda cuántos cambios consumió esa matrícula y evita conceder un
tercero. Perder una hora sin alternativa o por agotar el límite no lo aumenta.

La operación de cancelación guarda todos esos cambios juntos. Si alguna parte
falla, no deja la práctica liberada con el contador o el historial incompletos.

La vista previa permite mostrar la consecuencia antes de que el alumno acepte
cancelar. Al confirmar se comprueba otra vez la disponibilidad del momento.
