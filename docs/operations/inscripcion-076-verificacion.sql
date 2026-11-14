begin read only;
do $$ begin if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Indicadores activados';end if;
 if has_function_privilege('authenticated','public.reserve_student_plan_change_v2(uuid,uuid,jsonb)','EXECUTE') then raise exception 'RPC expuesta';end if;end $$;
select count(*) from public.student_schedule_reservations;
rollback;
