-- SOLO LECTURA. Revisar antes de aplicar 033; requiere 030, 031 y 032.
begin read only;
select to_regclass('public.notifications') as tabla_nueva_debe_ser_null,
  to_regprocedure('public.swap_practice_slot(uuid,uuid,uuid)') as cambio_e2,
  to_regprocedure('private.eligible_practice_slot_changes(uuid)') as elegibilidad_e2,
  to_regprocedure('public.cancel_practice_slot_with_reason(uuid,uuid,text,text)') as cancelacion_e1,
  to_regprocedure('public.transition_practice_slot_for_scheduler(uuid,text,text)') as scheduler;
select proname, pg_get_functiondef(oid) as definicion_actual
from pg_proc where oid in (
  'public.practice_slot_transition_due(public.practice_slots,text,timestamptz)'::regprocedure,
  'public.transition_practice_slot_for_scheduler(uuid,text,text)'::regprocedure,
  'public.swap_practice_slot(uuid,uuid,uuid)'::regprocedure,
  'public.cancel_practice_slot_with_reason(uuid,uuid,text,text)'::regprocedure);
-- Las marcas existentes no se borran ni se convierten en avisos retroactivos.
select status, count(*) as practicas, count(confirmation_notified_at) as ya_notificadas
from public.practice_slots group by status order by status;
-- Una matricula invalida no recibira ofertas urgentes; no se inventan defaults.
select id as enrollment_id from public.enrollments where status='activo' and
  (practice_plan is null or practice_plan->>'fechaFinElegida' is null
    or practice_plan->>'modalidad' is null or practice_plan->>'horasPorDia' is null);
rollback;
