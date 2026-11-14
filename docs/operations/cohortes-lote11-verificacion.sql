begin;
do $$begin
 if exists(select 1 from public.enrollment_rule_flags where enabled or not implemented) then raise exception 'L11 requiere 14 implementados y apagados';end if;
 if to_regprocedure('public.manual_plan_preview_v2(uuid,public.course_type,jsonb,uuid)') is null then raise exception 'Falta integración de caja';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('manual_plan_preview_v2','enrollment_metrics_v2','monitor_enrollment_rules_v2','assert_enrollment_permission_v2') and has_function_privilege('authenticated',p.oid,'execute')) then raise exception 'RPC pública sin cerrar';end if;
end $$;
select key,enabled,implemented from public.enrollment_rule_flags order by key;
rollback;
