begin read only;
select student_id,course_type,array_agg(id) ids from public.enrollments where status in ('activo','pendiente_cohorte') group by 1,2 having count(*)>1;
select entity_type,entity_id,issue,evidence from private.lote1_preflight_cases;
select count(*) historicos_sin_guard from public.enrollments where not individual_dates_guard_ready;
do $$ begin if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Apagar indicadores';end if;end $$;
rollback;
