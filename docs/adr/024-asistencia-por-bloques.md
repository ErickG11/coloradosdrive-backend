# ADR 024 — Asistencia y reprogramación por bloque del día

- Estado: aceptado para C14; sustituye el alcance C13.
- Decisión del dueño: 13/11/2026, incluyendo las reglas ratificadas el 12/11.
- Base de aplicación: migraciones aprobadas 001–087; despliegue C14: 088–091.

## Contexto

I01 reprodujo que reserva y pago activaban diez franjas pero dejaban `practice_plan=NULL`. Asistencia leía `fechaFinElegida`, `modalidad` y `horasPorDia` de ese JSON y rechazaba la vista previa con CD409. Además, la cancelación y el intercambio antiguos actuaban por hora, lo que podía fragmentar un día de dos horas.

## Decisión del dueño: R1–R9

1. **R1. Unidad:** matrícula y fecha civil en `America/Guayaquil`. Un bloque contiene todas las horas consecutivas del día, una o dos, con un solo instructor. No se divide al cancelar, cambiar, reponer o confirmar.
2. **R2. Tope permanente:** dos reprogramaciones por matrícula, nunca por semana. Un bloque reprogramable consume una y crea un pendiente; reponerlo no consume otra. Sin alternativas antes del cierre se registra `hora_perdida`, sin consumo. Tras usar dos, un nuevo aviso registra `falta`, libera el bloque y explica que el alumno debe hablar con la escuela o con su instructor.
3. **R3. Reposición:** bloque liberado por otro alumno o bloque libre del instructor original; si ese instructor no tiene alternativas, se ofrecen otros identificados por nombre. Misma duración y modalidad, un bloque por fecha de cada matrícula, sin solapes con ninguna otra práctica del alumno ni retenciones ajenas, inicio desde 06:00, fin dentro de `practicas_hora_fin` y antes de la fecha fin individual. No se retoma el mismo bloque soltado. El cierre de reclamación conserva la regla existente de T−5: se exige **más de** cinco minutos. La ventana empieza en ahora + cinco minutos; no se impone como límite inferior la fecha inicial original del plan.
4. **R4. Cambio sin pendiente:** se identifica el bloque propio a soltar y se consume una reprogramación. Las opciones incluyen únicamente orígenes que satisfacen las condiciones. El horario de destino no puede solaparse con una práctica actual: Prueba 1 no puede tomar 07:00–09:00 cambiando únicamente de instructor (S1).
5. **R5. Cadena de liberaciones:** cancelación y cambio notifican a compañeros elegibles de la misma cohorte y modalidad, con la misma duración y ventana. El bloque que se suelta al cambiar también se ofrece.
6. **R6. Canales:** bandeja y Realtime. Correo de asistencia únicamente para el recordatorio existente T−20 y `sin_practica_instructor` al cierre T−5 o cancelación tardía. Ningún correo masivo de cupos. Los tipos nuevos son exclusivamente de bandeja, también mediante restricción SQL.
7. **R7. Inicio:** un bloque cuya primera hora comenzó no se cancela en la plataforma. Un aviso dentro de los últimos cinco minutos deja todas sus horas `sin_practica` y encola un solo aviso de bloque al instructor.
8. **R8. Competencia:** la confirmación obtiene los recursos bajo bloqueo y vuelve a comprobar disponibilidad. Un segundo intento con una opción consumida recibe CD409 con «Otro alumno tomó este cupo». No se adjudica un instructor retenido por otra reserva.
9. **R9. Confirmación:** opcional y de día completo. No registra asistencia física ni suma horas de certificación. El instructor conserva el registro auditado de asistencia por hora, presentado dentro del bloque; objetivo y oferta de diez horas permanecen intactos.

## Contrato y compatibilidad

La 088 centraliza el contrato en un disparador BEFORE de matrícula. Reserva, pago, matrícula manual y cambio confirmado pasan por esa escritura. Se conservan las demás claves del JSON y los objetivos históricos.

El relleno de contratos nulos usa exclusivamente una reserva **confirmada** que demuestre matrícula, alumno, cohorte, fechas y número de retenciones. Reservas en curso sirven para la escritura de sus propios flujos únicamente dentro del disparador. La matrícula manual conserva su input validado y sus fechas canónicas. Si no existe prueba inequívoca, no se inventan modalidad, horas ni fechas: la verificación imprime la matrícula pendiente de revisión.

Se mantiene una fila de `practice_slot_cancellations` por bloque: `block_slot_ids`, `block_hours` y `block_local_date` conservan la instantánea. Así se respeta la unicidad histórica del número de reprogramación. Los pendientes se resuelven del más antiguo al más reciente. La duración de destino corresponde al bloque real de origen o al pendiente, incluso si un último bloque histórico es más corto que la jornada nominal; no se cambia el objetivo histórico. El historial conserva una entrada de cancelación y usa su duración completa al calcular horas perdidas. Las filas antiguas sin campos de bloque mantienen duración de una hora.

Los endpoints y las funciones por franja siguen disponibles. La interfaz C14 utiliza exclusivamente las operaciones por bloque. No se convierten ni borran auditorías históricas.

## Disponibilidad, bloqueo y avisos

La lista y las escrituras comparten `practice_block_options_v14`, que consulta `free_instructors_v2` con todos los instantes del bloque. Las opciones libres se materializan únicamente al confirmar la toma. Reserva, pago y cambio de plan seleccionan un instructor para el día completo, preservando preferencia por las retenciones cuando es posible.

El orden de escritura es candado del alumno, usuario, matrícula, cohorte, candado global de horarios y filas por UUID. Contador, liberación, adjudicación, auditoría y bandeja se confirman juntos. Realtime se emite después de la RPC; un fallo de transporte no revierte una operación ya confirmada.

Los cupos se agrupan por destinatario y matrícula en una sola notificación actualizable. El aviso del instructor se actualiza y vuelve a marcar como no leído cuando el mismo bloque pasa de libre a ocupado. Las faltas administrativas conservan una instantánea independiente de la franja reutilizable. La política de Realtime del canal personal de avisos solo permite al usuario activo leer su propio canal.

## Consecuencias y pendientes de negocio

- Se conservan fechas individuales, precios, pagos, reglas de acceso y objetivos; la reposición no amplía automáticamente la fecha fin.
- Recuperar horas perdidas mediante extensión de plan queda para otra decisión e implementación.
- La recuperación de faltas —horas extra pagadas o ausencia de certificación— sigue pendiente de negocio. C14 no concede crédito automático por una falta.
- Un correo opcional de resumen queda para después; no se activa en C14.
- La aceptación local usa PostgreSQL en memoria y termina en ROLLBACK. **S7 con dos sesiones PostgreSQL independientes queda pendiente:** no hay servidor/binarios nativos disponibles; la secuencia ganador/perdedor y los bloqueos no sustituyen esa prueba.

Despliegue, APIs, privilegios y evidencia: [operación C14](../operations/asistencia-c14-operacion.md) y [aceptación C14](../operations/asistencia-c14-aceptacion.md).

## Adendo C17 (13/11/2026): aviso de inasistencia en un solo paso

Decisión del dueño del 13/11/2026. **Reemplaza a R3 y R4 de C14** y al flujo «cancelar y reponer después» (bloque pendiente, vencimiento y selector posterior). Se mantienen R1, R2 (tope de dos reprogramaciones), R5 a R9. Aplicación: migración **092**, después de la 091.

Motivo: en la aplicación real una cancelación «reprogramable» ofreció y permitió tomar un bloque libre de otro día y anterior al inicio del plan, y otro alumno con otro instructor vio el cupo liberado. La ventana [ahora+5 min, fecha fin] sin límite de día ni de instructor producía unas 850 opciones por alumno.

1. **U1. Un solo paso.** Al avisar que no asistirá a un bloque del día D, el alumno elige ahí mismo (A) cambiar a otra hora ese mismo día o (B) no poder ese día. No existe el estado intermedio: sin bloque pendiente, sin vencimiento, sin selector posterior. Cerrar el diálogo no cambia nada.
2. **U2. Cambiar a otra hora (A).** Solo horas libres del mismo instructor, en la misma fecha D, con la misma duración (1 o 2 horas consecutivas), inicio desde las 06:00 y fin hasta `app_settings.practicas_hora_fin`, con más de cinco minutos de anticipación, distintas del bloque que suelta y sin solape con ninguna práctica ni retención del alumno en ninguna de sus matrículas. La disponibilidad real sale de `free_instructors_v2`. El bloque nuevo toma la cohorte de la matrícula, consume una reprogramación y el viejo queda liberado.
3. **U3. No puedo ese día (B).** Se registra como **falta**, sin consumir reprogramación y sin tope de faltas. El bloque se libera, se avisa al administrador y al instructor, y el alumno recibe: «Registramos tu inasistencia del <fecha> como falta. Esta hora no se repone automáticamente. Para reponerla en otra fecha, habla con la escuela o con tu instructor en tu siguiente práctica.»
4. **U4.** (A) solo se ofrece si hay al menos una hora libre del instructor ese día y quedan reprogramaciones; si no, solo (B), con el motivo explicado.
5. **U5. Tomar un cupo liberado.** Se ofrece, se avisa y se puede tomar únicamente si: misma cohorte que la franja, mismo instructor que el bloque propio que soltaría, misma fecha que ese bloque, misma duración, no lo soltó el propio alumno, menos de dos reprogramaciones usadas (consume una), sin solape global, horario permitido y más de cinco minutos de anticipación. Tomarlo suelta el bloque propio de ese día. Nunca cupos de otro día, otra cohorte u otro instructor.
6. **U6.** Todo se revalida en el servidor al escribir. Una opción manipulada recibe CD409 con un mensaje en español.
7. **U7.** Se mantienen: un bloque iniciado no se avisa; dentro de los últimos cinco minutos solo cabe el aviso de falta (franjas `sin_practica` y aviso inmediato al instructor con correo en cola); gana el primero en confirmar; el motivo (seis categorías y mínimo 10 caracteres) se pide una sola vez, en ambos caminos; solo cuenta la asistencia registrada por el instructor.
8. **U8. Avisos.** Todos de bandeja salvo T−20 y el cierre al instructor. Alumno: texto exacto de cada camino («Cambiamos tu bloque del <fecha> de <hora vieja> a <hora nueva> con <instructor>. Usaste N de 2 reprogramaciones.» o el de U3). Instructor (`cambio_agenda_instructor`): «el alumno movió su bloque de X a Y», «el alumno no asistirá el bloque X» o «un alumno tomó este bloque». Administrador (`falta_registrada_admin`) por cada falta. `cupo_disponible`, agrupado, solo a alumnos elegibles según U5.

**Compatibilidad.** Las funciones y rutas de C14 se conservan. `private.practice_block_options_v14` ahora devuelve únicamente cupos liberados que cumplen U5, y con fecha de cancelación (uso anterior) devuelve vacío: la cancelación anterior solo puede terminar en `falta` u `hora_perdida`, nunca en un pendiente. Las reposiciones pendientes ya creadas en la base real siguen en la auditoría, pero la interfaz ya no las ofrece. La auditoría gana la columna `accion` (`mover`, `falta`, `tomar_cupo`), nula en las filas anteriores. Un cambio de hora se audita como `reprogramable` con reposición ya registrada (`origen='cambio_cupo'`), sin pendiente.

Detalle técnico, endpoints y orden de aplicación: [operación C17](../operations/asistencia-c17-operacion.md).
