begin read only;
select key,enabled,implemented from public.enrollment_rule_flags;
select entity_type,entity_id,issue,evidence from private.lote1_preflight_cases;
do $$ begin if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Apagar indicadores antes de migrar';end if;end $$;
rollback;
