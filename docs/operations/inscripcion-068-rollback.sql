-- Rollback FUNCIONAL no destructivo. Primero revertir 069 si fue aplicada.
-- Conserva esquema aditivo, datos explícitos y procedencia: nunca DROP/CASCADE.
begin;
set local lock_timeout='5s';
do $$ begin
 if exists(select 1 from private.enrollment_backfill_069 where rolled_back_at is null) then
   raise exception 'Revertir 069 antes de 068';end if;
 if exists(select 1 from public.enrollments where individual_dates_guard_ready) then
   raise exception 'Guard individual ya usado: requiere rollback del lote que lo activó';end if;
end $$;
update public.enrollment_rule_flags set enabled=false,implemented=false,
 reason='Rollback funcional 068; esquema y datos preservados',updated_at=clock_timestamp();
commit;
