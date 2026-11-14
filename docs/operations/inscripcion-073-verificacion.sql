begin read only;
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Indicadores activados';end if;
 if not exists(select 1 from pg_trigger where tgname='cohorts_00_admin_rules') then raise exception 'Guard ausente';end if;
 if has_function_privilege('authenticated','public.write_cohort_v2(uuid,uuid,timestamptz,jsonb,text)','EXECUTE') then raise exception 'RPC expuesta';end if;
end $$;
select count(*) cohortes,count(codigo) codigos from public.cohorts;
select tipo,precio_centavos from public.course_type_prices;
rollback;
