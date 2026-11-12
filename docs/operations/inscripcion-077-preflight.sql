begin read only;
select * from private.lote1_preflight_cases;
select key,enabled,implemented from public.enrollment_rule_flags;
do $$ begin if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Apagar indicadores';end if;end $$;
rollback;
