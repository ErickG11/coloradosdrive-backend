begin read only;
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Indicadores activados';end if;
 if to_regclass('public.enrollments_one_active_per_student') is null then raise exception 'Falta guard heredado con indicadores apagados';end if;
 if to_regclass('public.enrollments_one_current_per_type') is null then raise exception 'Falta guard por tipo';end if;
 if has_function_privilege('authenticated','public.extend_enrollment_access_v2(uuid,uuid,date,text)','EXECUTE') then raise exception 'RPC expuesta';end if;
end $$;
rollback;
