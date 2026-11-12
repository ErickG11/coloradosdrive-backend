begin read only;
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled)
   or exists(select 1 from public.enrollments where individual_dates_guard_ready) then
   raise exception '069 activó reglas';end if;
 if exists(select 1 from public.enrollments e join private.lote1_enrollment_evidence v on v.id=e.id
   where e.individual_dates_source in ('practice_plan','reservation_holds','practice_slots') and
   (v.date_issue is not null or e.practice_start_date is distinct from v.proposed_start
     or e.practice_end_date is distinct from v.proposed_end)) then
   raise exception 'Fechas no respaldadas por evidencia';end if;
 if exists(select 1 from public.cohorts where codigo is null) then raise exception 'Código histórico pendiente';end if;
 if exists(select 1 from public.student_schedule_reservations where precio_snapshot_source='reservation_creation') then
   raise exception '069 no puede afirmar precio capturado al reservar históricamente';end if;
 if exists(select 1 from private.enrollment_backfill_069 where evidence='{}'::jsonb) then raise exception 'Falta procedencia';end if;
end $$;
select entity_type,entity_id,issue,evidence from private.lote1_preflight_cases order by entity_type,entity_id,issue;
rollback;
