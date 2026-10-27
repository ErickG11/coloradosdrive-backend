# Asistencia E3: bandeja y recordatorios

Rama compartida para E3 y E4: `feat/asistencia-e3-e4`, desde `main` actualizado (`64ff465`). Esta entrega implementa solo el backend E3. Se eligió **033**, libre en `migrations/` y en los borradores de `docs/operations/`; el borrador de Cohortes sigue numerado 030 fuera de la cadena aplicada.

## Bandeja y eventos

`notifications` guarda propietario, tipo, título, mensaje, franja y horario como instantáneas, fechas de creación/lectura y estado de correo. RLS habilitada, sin políticas ni grants para `anon`/`authenticated`. Solo el backend con `service_role` accede mediante funciones `SECURITY INVOKER` con `search_path` vacío. Cada RPC de lectura/marcado filtra por el usuario recibido del JWT en el controller; no se admite un propietario del body/query. Una cuenta inactiva o con rol diferente de estudiante/instructor recibe 403. El FK de usuario con `ON DELETE CASCADE` limpia su bandeja en la eliminación definitiva ya existente; no se modifica `delete_student_data`.

Tipos iniciales, todos idempotentes por `(user_id, tipo, practice_slot_id)`:

- `recordatorio_practica`: alumno, bandeja y correo, desde T−20 hasta antes del inicio; asignada o confirmada.
- `resultado_cancelacion`: alumno, solo bandeja. Mensaje según `reprogramable`, `hora_perdida` o `falta`; se conserva el significado de E1, sin registrar asistencia real.
- `cupo_disponible`: solo bandeja para alumnos elegibles de la misma cohorte según E2/032 al liberarse. No se oferta si faltan 5 minutos o menos. No se notifica al alumno que lo soltó. Un plan inválido que genere CD409 se excluye del reparto y no bloquea una cancelación ajena. El aviso es histórico: al abrirlo hay que consultar la disponibilidad actual; no garantiza una reserva.
- `sin_practica_instructor`: instructor, bandeja y correo. Cancelación tardía E1 o cierre de un cupo liberado vacío a T−5.
- `cambio_realizado`: alumno, solo bandeja, al completar A o B. El origen B no genera ofertas ni cascada.

Los avisos se insertan dentro de las mismas transacciones SQL de las acciones y del scheduler. Realtime conserva los eventos existentes para invalidar la pantalla; perder un Broadcast ya no pierde la bandeja. No hay migración retroactiva de avisos ni se borran las marcas de recordatorios anteriores.

## Contrato HTTP para E4

Requiere `Authorization: Bearer <JWT>` de estudiante o instructor activo y con su cambio obligatorio de contraseña resuelto. Fechas de respuesta: ISO 8601; E4 debe presentarlas en `America/Guayaquil`. Se devuelve exclusivamente la bandeja del propietario, incluso si se agregan campos `userId` al body o query.

- `GET /notifications?page=1&pageSize=20`: 200 con `{items, page, pageSize, total, unreadCount}`. `page`: entero 1–1000000; `pageSize`: entero 1–100. Orden: `createdAt` descendente, luego `id` descendente. `unreadCount` cuenta toda la bandeja del usuario, no solo la página. Una página posterior al final devuelve `items: []`, conservando los conteos.
- Cada elemento de `items`: `{id, tipo, titulo, mensaje, practiceSlotId, scheduledAt, createdAt, readAt, emailStatus, emailAttempts}`. `practiceSlotId`, `scheduledAt` y `readAt` pueden ser `null`. `emailStatus`: `pendiente`, `enviado`, `fallido` o `null` para avisos que no requieren correo; `emailAttempts`: 0–3. No se devuelven tokens de reserva, errores SMTP ni direcciones de correo. Los cinco valores de `tipo` son los enumerados arriba.
- `PATCH /notifications/:id/read`: sin body necesario. 200 con el elemento actualizado. Es idempotente: conserva el primer `readAt`. Un ID ajeno o inexistente devuelve 404 `Notificación no encontrada`.
- `POST /notifications/read-all`: sin body necesario. 200 `{updatedCount: number}`; solo modifica los avisos propios que estaban sin leer. Repetirlo devuelve 0 si no llegaron avisos nuevos.
- 400 de validación: `{status:'error', message, code:'INVALID_FIELD', field}` para UUID/paginación inválidos. 401: sesión ausente/inválida. 403: rol/cuenta no permitidos. Errores internos: 500. El middleware existente puede añadir `stack` fuera de producción.

## Scheduler y correo

El cron continúa cada minuto. PostgreSQL vuelve a comprobar estado, versión y reloj bajo lock. Al recordar, actualiza `confirmation_notified_at` e inserta una única notificación en la misma transacción. Una asignada sin confirmar nunca se cierra a T−5; asignadas y confirmadas se completan al terminar su bloque. La confirmación sigue siendo opcional.

La cola de correo usa una concesión con token y vencimiento de 2 minutos, `FOR UPDATE SKIP LOCKED` y contador persistido antes del intento. Un error conserva la bandeja y deja el correo pendiente para el siguiente minuto; tras 3 intentos queda `fallido` con el último error truncado a 1000 caracteres. Un proceso interrumpido permite recuperar la concesión vencida; un tercer intento interrumpido también termina en `fallido`. Un token anterior no puede finalizar una concesión nueva. No se reintentan correos ya enviados y no se envían recordatorios de prácticas iniciadas, movidas o ya no asignadas al destinatario.

La cola se atiende aun si una transición del scheduler falla. Cada pasada procesa hasta 20 correos, dejando de reservar nuevos tras 45 segundos; el trabajo restante sigue en base para la siguiente pasada. SMTP tiene timeouts de conexión/saludo de 10 segundos y socket de 30 segundos. El cron evita superponerse dentro del proceso y los tokens protegen entre procesos. Solo se envían correos de recordatorio y de bloque vacío al instructor; no se agregan correos de ofertas, cambios o resultados de cancelación.

`formatEcuadorDateTime` es el único formateador de fechas en correos. Usa `America/Guayaquil`, español y hora 24 h con «(hora de Ecuador)». También conserva el día civil de las fechas de matrícula `YYYY-MM-DD`. El recordatorio incluye la hora programada y evita decir «en 20 minutos» cuando la pasada o un reintento llegan después de T−20.

SMTP no ofrece una transacción conjunta con PostgreSQL: si acepta el correo y el proceso cae antes de registrar `enviado`, una recuperación puede volver a enviarlo. Se conserva el mismo `Message-ID`, pero esto no garantiza deduplicación por todos los proveedores. La bandeja y la marca automática sí son únicas. No se promete entrega exactamente una vez del correo en esa ventana de fallo.

## Aplicación y verificación

1. Revisar y ejecutar `asistencia-e3-preflight.sql` como consulta de solo lectura. Comparar las definiciones desplegadas con 030/032 y revisar los planes incompletos indicados.
2. Coordinar una ventana sin cron ni acciones de cancelación/cambio, aplicar 033 manualmente y desplegar este backend antes de reabrirla. El backend anterior seguiría enviando SMTP directamente mientras 033 ya deja correos pendientes, lo que podría duplicar envíos al activar E3. El backend E3 necesita las RPC de 033; no desplegarlo en servicio antes de la migración.
3. Ejecutar `asistencia-e3-verificacion.sql` ENTERO con su `ROLLBACK` final. Crea fixtures nuevos, no envía SMTP ni Broadcast. Probar después con cuentas de prueba la API y el correo real.
4. El rollback restaura exactamente las funciones 030/032 y solo permite retirar 033 si la tabla está vacía. Si ya hay bandeja, aborta para no perderla; preparar corrección de avance. Detener el backend E3 antes de retirar sus RPC.

Pruebas locales: `DISABLE_CRON=true npm run test:notifications-db`, Jest de API/cola/scheduler/cancelación/cambio/correos afectados, `tsc --noEmit`, build y lint. PGlite ensaya idempotencia, propietario, intentos, concesión vencida, recordatorio obsoleto, resultados E1, ofertas elegibles, cambio sin cascada, T−20/T−5, permisos y aplicación/rollback exacto y protegido. Usa una conexión; no prueba bloqueos simultáneos reales entre procesos. Los tests HTTP usan Supabase mockeado.

Resultado de esta entrega: 108 tests Jest en 9 suites, ensayo PGlite, typecheck, build y lint correctos. Sigue apareciendo el aviso de configuración TS151002 de ts-jest preexistente; las suites terminaron con código 0.

No se aplicó SQL en Supabase ni se verificaron SMTP real, Railway, la configuración remota del cron o los datos desplegados. La aplicación hasta 032 procede de la confirmación del usuario. E4 frontend, bandeja de admin, nuevos recordatorios ajenos a RF-03, reintento manual y purga/retención automática de avisos quedan fuera de esta entrega.
