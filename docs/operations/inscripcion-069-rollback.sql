-- Rollback funcional 069. Preserva historial de procedencia; falla si un consumidor cambió los datos.
begin;
set local lock_timeout='5s';
lock table public.enrollments,public.student_schedule_reservations,public.cohorts in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Apagar indicadores antes del rollback';end if;
end $$;
alter table public.enrollments disable trigger enrollments_set_updated_at;
alter table public.cohorts disable trigger cohorts_set_updated_at;

do $$ begin
 if exists(select 1 from private.enrollment_backfill_069 b left join public.enrollments e on e.id=b.entity_id
 where b.entity_type='enrollment' and b.rolled_back_at is null and
 (e.id is null or jsonb_build_object(
   'practice_start_date',
   e.practice_start_date,
   'practice_end_date',
   e.practice_end_date,
   'access_end_date',
   e.access_end_date,
   'paid_amount_centavos',
   e.paid_amount_centavos,
   'individual_dates_source',
   e.individual_dates_source,
   'individual_dates_guard_ready',
   e.individual_dates_guard_ready) is distinct from b.after_value)) then
 raise exception '069 rollback: enrollment cambió o ya no existe; revisar sin sobrescribir';end if;
end $$;
update public.enrollments e set practice_start_date=v.practice_start_date,
 practice_end_date=v.practice_end_date,
 access_end_date=v.access_end_date,
 paid_amount_centavos=v.paid_amount_centavos,
 individual_dates_source=v.individual_dates_source,
 individual_dates_guard_ready=v.individual_dates_guard_ready
 from private.enrollment_backfill_069 b,
 lateral jsonb_populate_record(null::public.enrollments,b.before_value) v
 where b.entity_type='enrollment' and b.entity_id=e.id and b.rolled_back_at is null;

do $$ begin
 if exists(select 1 from private.enrollment_backfill_069 b left join public.student_schedule_reservations e on e.id=b.entity_id
 where b.entity_type='reservation' and b.rolled_back_at is null and
 (e.id is null or jsonb_build_object(
   'practice_start_date',
   e.practice_start_date,
   'practice_end_date',
   e.practice_end_date,
   'precio_snapshot_centavos',
   e.precio_snapshot_centavos,
   'precio_snapshot_source',
   e.precio_snapshot_source,
   'precio_snapshot_at',
   e.precio_snapshot_at) is distinct from b.after_value)) then
 raise exception '069 rollback: reservation cambió o ya no existe; revisar sin sobrescribir';end if;
end $$;
update public.student_schedule_reservations e set practice_start_date=v.practice_start_date,
 practice_end_date=v.practice_end_date,
 precio_snapshot_centavos=v.precio_snapshot_centavos,
 precio_snapshot_source=v.precio_snapshot_source,
 precio_snapshot_at=v.precio_snapshot_at
 from private.enrollment_backfill_069 b,
 lateral jsonb_populate_record(null::public.student_schedule_reservations,b.before_value) v
 where b.entity_type='reservation' and b.entity_id=e.id and b.rolled_back_at is null;

do $$ begin
 if exists(select 1 from private.enrollment_backfill_069 b left join public.cohorts e on e.id=b.entity_id
 where b.entity_type='cohort' and b.rolled_back_at is null and
 (e.id is null or jsonb_build_object(
   'codigo',
   e.codigo) is distinct from b.after_value)) then
 raise exception '069 rollback: cohort cambió o ya no existe; revisar sin sobrescribir';end if;
end $$;
update public.cohorts e set codigo=v.codigo
 from private.enrollment_backfill_069 b,
 lateral jsonb_populate_record(null::public.cohorts,b.before_value) v
 where b.entity_type='cohort' and b.entity_id=e.id and b.rolled_back_at is null;

update private.enrollment_backfill_069 set rolled_back_at=clock_timestamp() where rolled_back_at is null;
alter table public.enrollments enable trigger enrollments_set_updated_at;
alter table public.cohorts enable trigger cohorts_set_updated_at;
commit;
