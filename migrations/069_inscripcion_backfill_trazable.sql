-- Lote 1: backfill demostrable, trazable y repetible. No activa guards ni usa datos de cohortes como históricos.
begin;
set local lock_timeout='5s';
lock table public.enrollments,public.student_schedule_reservations,public.cohorts in share row exclusive mode;
lock table public.payments,public.student_schedule_holds in share mode;
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then
   raise exception '069: requiere todos los indicadores apagados'; end if;
end $$;
-- Mantener intactas las versiones anteriores al backfill de columnas nuevas.
alter table public.enrollments disable trigger enrollments_set_updated_at;
alter table public.cohorts disable trigger cohorts_set_updated_at;

insert into private.enrollment_backfill_069(entity_type,entity_id,before_value,after_value,evidence)
select 'enrollment',e.id,jsonb_build_object(
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
   e.individual_dates_guard_ready),jsonb_build_object(
   'practice_start_date',
   case when v.date_issue is null then v.proposed_start end,

   'practice_end_date',
   case when v.date_issue is null then v.proposed_end end,

   'access_end_date',
   case when v.date_issue is null then v.proposed_end end,

   'paid_amount_centavos',
   v.proposed_paid_amount,

   'individual_dates_source',
   case when v.date_issue is null then v.proposed_source end,

   'individual_dates_guard_ready',
   false),jsonb_build_object(
   'performedBy',
   'migration_069',
   'planHash',
   v.plan_hash,
   'source',
   v.proposed_source,
   'dateIssue',
   v.date_issue,
   'moneyIssue',
   v.money_issue,
   'paymentIds',
   v.payment_ids,
   'confirmedReservations',
   v.confirmed_reservations,
   'holdCount',
   v.hold_count,
   'slotCount',
   v.slot_count,
   'slotAssociations',
   v.slot_associations,
   'guardActivated',
   false)
 from public.enrollments e join private.lote1_enrollment_evidence v on v.id=e.id
 where e.practice_start_date is null and e.practice_end_date is null and e.access_end_date is null and e.paid_amount_centavos is null and e.individual_dates_source is null
   and not e.individual_dates_guard_ready
on conflict(entity_type,entity_id) do update
 set before_value=excluded.before_value,after_value=excluded.after_value,evidence=excluded.evidence,
 applied_at=clock_timestamp(),rolled_back_at=null
 where enrollment_backfill_069.rolled_back_at is not null;
update public.enrollments e set
 practice_start_date=v.practice_start_date,
 practice_end_date=v.practice_end_date,
 access_end_date=v.access_end_date,
 paid_amount_centavos=v.paid_amount_centavos,
 individual_dates_source=v.individual_dates_source,
 individual_dates_guard_ready=v.individual_dates_guard_ready
 from private.enrollment_backfill_069 b,
 lateral jsonb_populate_record(null::public.enrollments,b.after_value) v
 where b.entity_type='enrollment' and b.entity_id=e.id and b.rolled_back_at is null
 and jsonb_build_object(
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
   e.individual_dates_guard_ready)=b.before_value;

insert into private.enrollment_backfill_069(entity_type,entity_id,before_value,after_value,evidence)
select 'reservation',e.id,jsonb_build_object(
   'practice_start_date',
   e.practice_start_date,
   'practice_end_date',
   e.practice_end_date,
   'precio_snapshot_centavos',
   e.precio_snapshot_centavos,
   'precio_snapshot_source',
   e.precio_snapshot_source,
   'precio_snapshot_at',
   e.precio_snapshot_at),jsonb_build_object(
   'practice_start_date',
   v.proposed_start,
   'practice_end_date',
   v.proposed_end,

   'precio_snapshot_centavos',
   case when v.price_count=1 then v.proposed_price end,

   'precio_snapshot_source',
   case when v.price_count=1 then 'payment_snapshot' end,

   'precio_snapshot_at',
   case when v.price_count=1 then v.price_evidence_at end),jsonb_build_object(
   'performedBy',
   'migration_069',
   'holdCount',
   v.hold_count,
   'expectedSlotCount',
   v.expected_slot_count,
   'priceCount',
   v.price_count,
   'priceSource',
   'payment_snapshot',
   'notReservationCreationPrice',
   true)
 from public.student_schedule_reservations e join private.lote1_reservation_evidence v on v.id=e.id
 where e.practice_start_date is null and e.practice_end_date is null and e.precio_snapshot_centavos is null and e.precio_snapshot_source is null and e.precio_snapshot_at is null

on conflict(entity_type,entity_id) do update
 set before_value=excluded.before_value,after_value=excluded.after_value,evidence=excluded.evidence,
 applied_at=clock_timestamp(),rolled_back_at=null
 where enrollment_backfill_069.rolled_back_at is not null;
update public.student_schedule_reservations e set
 practice_start_date=v.practice_start_date,
 practice_end_date=v.practice_end_date,
 precio_snapshot_centavos=v.precio_snapshot_centavos,
 precio_snapshot_source=v.precio_snapshot_source,
 precio_snapshot_at=v.precio_snapshot_at
 from private.enrollment_backfill_069 b,
 lateral jsonb_populate_record(null::public.student_schedule_reservations,b.after_value) v
 where b.entity_type='reservation' and b.entity_id=e.id and b.rolled_back_at is null
 and jsonb_build_object(
   'practice_start_date',
   e.practice_start_date,
   'practice_end_date',
   e.practice_end_date,
   'precio_snapshot_centavos',
   e.precio_snapshot_centavos,
   'precio_snapshot_source',
   e.precio_snapshot_source,
   'precio_snapshot_at',
   e.precio_snapshot_at)=b.before_value;

insert into private.enrollment_backfill_069(entity_type,entity_id,before_value,after_value,evidence)
select 'cohort',e.id,jsonb_build_object(
   'codigo',
   e.codigo),jsonb_build_object('codigo','CD-'||replace(e.id::text,'-','')),jsonb_build_object(
   'performedBy',
   'migration_069',
   'source',
   'cohort_uuid',
   'notStudentVisible',
   true)
 from public.cohorts e
 where e.codigo is null

on conflict(entity_type,entity_id) do update
 set before_value=excluded.before_value,after_value=excluded.after_value,evidence=excluded.evidence,
 applied_at=clock_timestamp(),rolled_back_at=null
 where enrollment_backfill_069.rolled_back_at is not null;
update public.cohorts e set
 codigo=v.codigo
 from private.enrollment_backfill_069 b,
 lateral jsonb_populate_record(null::public.cohorts,b.after_value) v
 where b.entity_type='cohort' and b.entity_id=e.id and b.rolled_back_at is null
 and jsonb_build_object(
   'codigo',
   e.codigo)=b.before_value;

alter table public.enrollments enable trigger enrollments_set_updated_at;
alter table public.cohorts enable trigger cohorts_set_updated_at;
commit;
