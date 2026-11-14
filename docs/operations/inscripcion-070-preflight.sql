begin read only;
do $$ begin
 if to_regclass('public.enrollment_rule_flags') is null or to_regprocedure('private.lote1_date(text)') is null then raise exception '070 requiere 068/069';end if;
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception '070 requiere indicadores apagados';end if;
end $$;
select entity_type,entity_id,issue,evidence from private.lote1_preflight_cases;
rollback;
