# ADR 009: Intervalos, duración y transiciones atómicas de prácticas (CD-05–07)

## Estado

Implementado en la rama del lote. Validación real de PostgreSQL pendiente.
Reglas ratificadas expresamente para este lote; no ratifica otras recomendaciones.
Reemplaza el tratamiento de `liberado` de la migración 010 y las comprobaciones
temporales y escrituras del scheduler anteriores. No cambia los permisos de asistencia.

## Decisión

Cada franja dura 60 minutos. La exclusión GiST de 018 combina UUID de instructor
(`btree_gist`) con el rango `[inicio, fin)`: permite 08:00–09:00 junto a 09:00–10:00
y rechaza intersecciones, incluso entre INSERT/UPDATE concurrentes. Protege cambios
de instructor, inicio, duración y estado. El generador consulta la misma expresión
mediante `practice_free_instructors`; la consulta mejora la respuesta y la exclusión
sigue siendo la garantía al escribir. Un INSERT masivo de PostgREST es una sentencia:
un conflicto revierte el bloque completo. Conflicto SQL `23P01` se convierte en HTTP 409.

| Estado | Ocupa el intervalo | Motivo |
|---|---|---|
| disponible | Sí | Franja ofrecida |
| asignado | Sí | Estudiante pendiente de confirmar |
| confirmado | Sí | Práctica comprometida |
| liberado | Sí | Continúa ofrecida y reclamable |
| sin_practica | No | Terminal tras el cierre; ya no se puede reclamar |
| completado | Sí | Práctica realizada: protege el historial contra otra escritura solapada |

`completado` es terminal, pero representa una práctica realizada; finalizarla no
permite insertar otra práctica solapada sobre ese instructor en el historial.
`sin_practica` representa un intervalo sin práctica realizada y no es reclamable.
No se añade exclusividad por estudiante ni una nueva regla para cancelar.

Se conserva `scheduled_at timestamptz` y la conversión explícita de Guayaquil a UTC
del generador. Para el índice se usa `tsrange(scheduled_at AT TIME ZONE 'UTC',
(scheduled_at AT TIME ZONE 'UTC') + interval '60 minutes', '[)')`. Convertir ambos
extremos a UTC para la expresión preserva el orden de los instantes sin cambiar los
datos almacenados. Evita `timestamptz + interval`, que es STABLE y no sirve como
expresión de índice. No se añade un final persistido ni un wrapper falsamente inmutable.

## Tiempo y concurrencia

`closeAt = inicio − 5 minutos`. Reclamar y confirmar requieren **ahora < closeAt**.
El cierre requiere **ahora >= closeAt**. Recordatorios: desde inicio − 20 minutos
hasta antes de closeAt. Completar: confirmado y ahora >= inicio + 60 minutos.
El predicado de ventana está centralizado en SQL. Las RPC de escritura no aceptan
un tiempo suministrado por el cliente; usan `clock_timestamp()` después de adquirir
el bloqueo y lo repiten en el UPDATE. `now()`/`transaction_timestamp()` conservarían
el inicio de una transacción que pudo esperar un lock; por eso no se usan para el plazo.
Node no decide el vencimiento ni selecciona candidatos con su reloj.

`act_on_practice_slot` bloquea la franja `FOR UPDATE`, revalida estado y propietario
y, al reclamar, bloquea `FOR SHARE` la matrícula activa en la misma cohorte. Dos
reclamantes compiten por la misma fila; el segundo ve el estado actualizado y recibe
409. Cancelar resetea el ciclo sin un límite temporal nuevo. No hay un SELECT de
autorización en Node seguido de una escritura que confíe en ese estado antiguo.

El scheduler recibe la fila y su `xmin` como texto, una versión interna de MVCC.
La RPC de transición bloquea la fila y compara esa versión; repite versión, estado,
propietario cuando corresponde y plazo en el UPDATE. Una carrera perdida devuelve
cero filas y el backend omite la transición, el correo y el evento. No usa `updated_at`
como contador: el trigger anterior utiliza `now()` y no garantiza versiones únicas.
Las versiones son efímeras, se usan en la misma pasada, no se guardan ni se exponen
en la API pública; no son IDs permanentes (XID puede reciclarse a largo plazo).

Correos y Realtime salen después de la respuesta de la RPC que confirma el commit.
Siguen siendo best-effort. El recordatorio marca el intento antes de enviarlo; una
caída entre commit y envío puede perder una notificación. No se garantiza entrega
exactamente una vez ni se introduce un outbox en este lote. Una acción posterior
puede cambiar la franja después del commit; un evento describe la transición ya
confirmada y el consumidor debe refrescar el estado vigente.

## Autorización y operación

Funciones SECURITY INVOKER, objetos cualificados y `search_path = ''`; EXECUTE
retirado a PUBLIC/anon/authenticated y concedido solo a service_role. RBAC y actor
del JWT permanecen en Express. Las RPC revalidan cohorte y propietario en la base;
no elevan privilegios ni cambian RLS. Los dos triggers de rol de 005 se cualifican
en 019 para que funcionen con el search_path vacío, con las mismas reglas.

018 exige registros compatibles bajo lock de tabla, falla con CD005/CD006 y no
normaliza ni elimina datos. Ver preflight, reversión y coordinación del despliegue
en `docs/operations/cd-05-07.md`. 018/019 y el backend forman un contrato conjunto.

## Validación y alternativas

Las pruebas Jest comprueban validación de duración, contrato HTTP y efectos tras
transiciones aceptadas/omitidas, usando mocks. `tests/database` prepara pruebas reales
de migraciones, restricciones, límites y sesiones concurrentes. No se ejecutó contra
PostgreSQL durante la implementación original; aprobar Jest no demuestra las garantías SQL.
La primera validación real posterior aprobó en PostgreSQL 17.6, con carreras y roles
efectivos: [registro y límites del laboratorio](../operations/cd-05-07-postgresql-lab.md).
Supabase/PostgREST, Auth, RLS, historial completo y Node 18 siguen pendientes.

Se descartaron consultas previas como única garantía (carrera), el índice único de
inicios (ignora intersecciones) y sumar intervalos directamente a timestamptz en un
índice (no inmutable). Se evita cambiar la representación temporal y añadir versiones
de aplicación cuando el bloqueo y la versión de PostgreSQL cubren la pasada del cron.

Referencias: [rangos y exclusión](https://www.postgresql.org/docs/17/rangetypes.html),
[funciones temporales](https://www.postgresql.org/docs/17/functions-datetime.html),
[índices e inmutabilidad](https://www.postgresql.org/docs/current/sql-createindex.html),
[funciones y permisos en Supabase](https://supabase.com/docs/guides/database/functions).
