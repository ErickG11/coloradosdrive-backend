begin;
set local lock_timeout='5s';
drop trigger enrollments_02_practice_contract_v14 on public.enrollments;
-- Rechazar rollback si alguien modificó después un contrato rellenado.
do $$begin if exists(select 1 from private.practice_contract_backfill_v14 b join public.enrollments e on e.id=b.enrollment_id where e.practice_plan is distinct from b.applied_plan) then raise exception 'ROLLBACK_088: hay contratos modificados después del relleno; revisar antes de revertir';end if;end $$;
update public.enrollments e set practice_plan=b.previous_plan from private.practice_contract_backfill_v14 b where e.id=b.enrollment_id;
drop function private.write_practice_contract_v14();
drop function private.resolve_practice_contract_v14(public.enrollments);
drop table private.practice_contract_backfill_v14;
notify pgrst, 'reload schema';
commit;
