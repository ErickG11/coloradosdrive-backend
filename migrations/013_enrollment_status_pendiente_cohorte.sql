-- 013_enrollment_status_pendiente_cohorte.sql
-- Fase 3: agrega el valor 'pendiente_cohorte' a enrollment_status, para
-- representar una inscripción ya aprobada (o, más adelante, ya pagada) que
-- todavía no tiene cohorte asignada porque ninguna cohorte del curso tenía
-- matrícula abierta al momento de la asignación automática.
--
-- Debe aplicarse en su propia transacción/migración: Postgres no permite
-- usar un valor de enum recién agregado en la misma transacción en la que
-- se agrega.
alter type enrollment_status add value 'pendiente_cohorte';
