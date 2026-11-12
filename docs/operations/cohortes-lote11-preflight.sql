begin;
do $$begin
 if (select count(*) from public.enrollment_rule_flags)<>14 or exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'L11 requiere 14 indicadores apagados';end if;
 if to_regprocedure('private.identity_number_valid_v2(text,text)') is null then raise exception 'L11 requiere 080';end if;
end $$;
select entity_type,entity_id,issue,evidence from private.lote1_preflight_cases order by entity_type,entity_id;
rollback;
