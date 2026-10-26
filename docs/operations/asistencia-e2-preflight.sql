-- SOLO LECTURA. Ejecutar antes de 031 y revisar con el responsable.
begin read only;
select to_regclass('public.practice_slot_cancellations') as historial_e1,
  to_regprocedure('private.eligible_free_slots_for_enrollment(uuid,uuid)') as elegibilidad_e1,
  to_regprocedure('public.cancel_practice_slot_with_reason(uuid,uuid,text,text)') as cancelacion_e1,
  to_regprocedure('public.delete_student_data(uuid,uuid,timestamptz,text[])') as eliminacion_e1;

-- Debe ser 0: no adoptar valores por defecto ni corregir matrículas automáticamente.
select count(*) as matriculas_activas_con_plan_incompleto from public.enrollments e
where status = 'activo' and (practice_plan is null
  or not coalesce(pg_input_is_valid(practice_plan->>'fechaFinElegida', 'date'), false)
  or coalesce(practice_plan->>'modalidad', '') not in ('entre_semana', 'fin_de_semana')
  or case when pg_input_is_valid(practice_plan->>'horasPorDia', 'integer')
      then (practice_plan->>'horasPorDia')::integer not between 1 and 16 else true end
  or case when pg_input_is_valid(coalesce(horas_practica_objetivo::text, practice_plan->>'horas'), 'integer')
      then coalesce(horas_practica_objetivo::text, practice_plan->>'horas')::integer <= 0 else true end);

-- Revisión de datos, no backfill: reposiciones hechas mediante el antiguo claim
-- no quedaron enlazadas al historial. Si hay cancelaciones E1 y reclamos previos,
-- contrastar el historial con operaciones reales antes de habilitar E2.
select e.id as enrollment_id, e.reprogramaciones_usadas,
  (select count(*) from public.practice_slot_cancellations c
    where c.enrollment_id = e.id and c.resultado = 'reprogramable') as cancelaciones_reprogramables,
  (select coalesce(sum(s.duration_minutes), 0) / 60 from public.practice_slots s
    where s.student_id = e.student_id and s.cohort_id = e.cohort_id
      and s.status in ('asignado', 'confirmado', 'completado')) as horas_programadas,
  e.horas_practica_objetivo, e.practice_plan->>'horas' as horas_plan
from public.enrollments e where exists(select 1 from public.practice_slot_cancellations c
  where c.enrollment_id = e.id and c.resultado = 'reprogramable');

select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid in ('public.practice_slots'::regclass, 'public.practice_slot_cancellations'::regclass)
  and (contype = 'x' or conname = 'practice_slot_cancellations_counter_consistency');
select has_function_privilege('service_role', 'private.eligible_free_slots_for_enrollment(uuid,uuid)', 'execute') as helper_permitido;
rollback;
