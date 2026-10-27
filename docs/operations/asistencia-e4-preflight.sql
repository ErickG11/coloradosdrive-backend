-- SOLO LECTURA. Ejecutar antes de 034 y revisar cada resultado.
select to_regclass('public.practice_attendance_events') as debe_ser_null,
  to_regprocedure('private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)') as requiere_033,
  to_regclass('public.notifications') as bandeja_033,
  to_regclass('public.practice_slot_cancellations') as historial_030;
select pg_get_functiondef('private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)'::regprocedure);
select indexdef from pg_indexes where schemaname = 'public' and indexname = 'notifications_automatic_unique';
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.notifications'::regclass and conname = 'notifications_tipo_check';
-- No inventar autor, fecha ni motivo para valores anteriores a E4.
select count(*) as registros_previos_sin_auditoria,
  count(*) filter (where attended) as asistidas_previas
from public.practice_slots where attended is not null;
-- Estas filas impiden atribuir practicas por matricula: el GET devolvera 409.
select student_id, cohort_id, array_agg(id order by created_at) as matriculas_ambiguas
from public.enrollments where cohort_id is not null group by student_id, cohort_id having count(*) > 1;
select id, scheduled_at, duration_minutes from public.practice_slots
where status = 'completado' and scheduled_at + make_interval(mins => duration_minutes) > clock_timestamp();
select has_table_privilege('service_role', 'public.notifications', 'insert') as puede_insertar_aviso,
  has_table_privilege('service_role', 'public.practice_slots', 'update') as puede_actualizar_franja;
-- Advertencia operativa: coordinar una pausa del registro/correccion de
-- asistencia, aplicar 034 y desplegar E4 antes de reabrir esa accion.
-- El trigger de 034 rechaza el UPDATE de asistencia del backend E3/main.
-- No pausa cancelaciones, cambios, correos ni transiciones del scheduler.
