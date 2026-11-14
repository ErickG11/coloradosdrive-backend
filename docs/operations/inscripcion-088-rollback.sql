begin;
set local lock_timeout='5s';
-- Rollback condicionado a los cuerpos instalados; nunca sobreescribir cambios ajenos.
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.write_practice_contract_v14()')) is distinct from 'bc246e4370f15426d192f5b7bd7d05df' then raise exception 'ROLLBACK_088: cuerpo desconocido: private.write_practice_contract_v14()';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.resolve_practice_contract_v14(enrollments)')) is distinct from '63409564a3b7ca540b85c1919968a8ab' then raise exception 'ROLLBACK_088: cuerpo desconocido: private.resolve_practice_contract_v14(enrollments)';end if;end $guard$;
drop trigger enrollments_02_practice_contract_v14 on public.enrollments;
-- Rechazar rollback si alguien modificó después un contrato rellenado.
do $$begin if exists(select 1 from private.practice_contract_backfill_v14 b join public.enrollments e on e.id=b.enrollment_id where e.practice_plan is distinct from b.applied_plan) then raise exception 'ROLLBACK_088: hay contratos modificados después del relleno; revisar antes de revertir';end if;end $$;
update public.enrollments e set practice_plan=b.previous_plan from private.practice_contract_backfill_v14 b where e.id=b.enrollment_id;
drop function private.write_practice_contract_v14();
drop function private.resolve_practice_contract_v14(public.enrollments);
drop table private.practice_contract_backfill_v14;
notify pgrst, 'reload schema';
commit;
