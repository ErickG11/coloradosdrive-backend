-- Lote 1: expansión compatible. MANUAL después de 067; NO aplicar 064.
-- Reaplicación no destructiva únicamente tras rollback funcional de 068/069.
begin;
set local lock_timeout='5s';
do $resume_068$
declare t text; pair record;
begin
 if to_regclass('public.enrollment_rule_flags') is not null then
   foreach t in array array['public.course_type_prices','public.enrollment_plan_options',
     'public.enrollment_admin_permissions','public.enrollment_domain_audit','public.enrollment_funnel_events',
     'private.enrollment_backfill_069','private.lote1_enrollment_evidence',
     'private.lote1_reservation_evidence','private.lote1_preflight_cases'] loop
     if to_regclass(t) is null then raise exception '068: instalación parcial, falta %',t;end if;
   end loop;
   for pair in select * from (values
     ('enrollments','practice_start_date'),('enrollments','practice_end_date'),('enrollments','access_end_date'),
     ('enrollments','paid_amount_centavos'),('enrollments','individual_dates_source'),('enrollments','individual_dates_guard_ready'),
     ('cohorts','codigo'),('cohorts','habilitada'),('cohorts','cancelled_at'),('cohorts','cancelled_by'),('cohorts','cancellation_reason'),
     ('student_schedule_reservations','precio_snapshot_centavos'),('student_schedule_reservations','precio_snapshot_source'),
     ('student_schedule_reservations','precio_snapshot_at'),('student_schedule_reservations','practice_start_date'),
     ('student_schedule_reservations','practice_end_date'),('student_schedule_reservations','admission_at'),
     ('student_schedule_reservations','admission_rule_version')) as x(tab,col) loop
     if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=pair.tab and column_name=pair.col) then
       raise exception '068: columna ausente %.%',pair.tab,pair.col;end if;
   end loop;
   if (select count(*) from public.enrollment_rule_flags)<>14
     or exists(select 1 from public.enrollment_rule_flags where enabled or implemented)
     or exists(select 1 from private.enrollment_backfill_069 where rolled_back_at is null) then
     raise exception '068: revertir primero 069/lotes posteriores y apagar indicadores';end if;
 else
   execute $foundation_068$
do $$ begin
  if to_regclass('public.payments') is null or to_regclass('public.subject_items') is null
    or not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='questions' and column_name='image_path') then
    raise exception '068 requiere las migraciones aprobadas hasta 067';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='courses' and column_name='precio') then
    raise exception '068: posible 064 aplicada; detener y revisar sin modificarla';
  end if;
end $$;

create table public.course_type_prices (
  tipo public.course_type primary key,
  precio_centavos bigint not null check(precio_centavos between 0 and 999999999),
  moneda text not null default 'USD' check(moneda='USD'),
  updated_by uuid not null references public.users(id) on delete restrict,
  motivo text not null check(length(btrim(motivo)) between 1 and 500),
  updated_at timestamptz not null default clock_timestamp()
);
comment on table public.course_type_prices is
  'Único precio futuro por tipo A/B. Vacío hasta cargar datos explícitos. Los lectores legacy continúan usando cohorts.precio hasta el lote 3.';

create table public.enrollment_rule_flags (
  key text primary key check(key in ('prices','date_rules','capacity','reservations','payments',
    'cohort_admin','enrollment_access','waitlist','schedule_changes','billing','identity',
    'foreign_identity','permissions','metrics')),
  enabled boolean not null default false,
  implemented boolean not null default false,
  updated_by uuid references public.users(id) on delete restrict,
  reason text not null default 'Pendiente de lote autorizado',
  updated_at timestamptz not null default clock_timestamp(),
  check(not enabled or implemented)
);
insert into public.enrollment_rule_flags(key) select unnest(array['prices','date_rules','capacity',
  'reservations','payments','cohort_admin','enrollment_access','waitlist','schedule_changes',
  'billing','identity','foreign_identity','permissions','metrics']);

create table public.enrollment_plan_options (
  modalidad text not null check(modalidad in ('entre_semana','fin_de_semana')),
  horas_por_dia integer not null check(horas_por_dia between 1 and 6),
  habilitada boolean not null,
  horas_objetivo integer not null default 15 check(horas_objetivo=15),
  motivo text not null,
  primary key(modalidad,horas_por_dia)
);
insert into public.enrollment_plan_options(modalidad,horas_por_dia,habilitada,motivo)
 select m,h,not(m='fin_de_semana' and h=1),
   case when m='fin_de_semana' and h=1 then 'Oferta pendiente de decisión de negocio'
   else 'Plan exacto de 15 horas aprobado; sin activar flujos' end
 from unnest(array['entre_semana','fin_de_semana']) m cross join generate_series(1,6) h;

create table public.enrollment_admin_permissions (
  admin_id uuid not null references public.users(id) on delete restrict,
  permission text not null check(permission in ('verify_identity','manage_cohorts_prices',
    'reassign_schedules','view_payments_invoices')),
  granted_by uuid not null references public.users(id) on delete restrict,
  reason text not null check(length(btrim(reason)) between 1 and 500),
  granted_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  primary key(admin_id,permission),
  check(revoked_at is null or revoked_at>=granted_at)
);
create index enrollment_admin_permissions_grantor on public.enrollment_admin_permissions(granted_by);

create table public.enrollment_domain_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  old_value jsonb,
  new_value jsonb,
  reason text not null check(length(btrim(reason))>0),
  occurred_at timestamptz not null default clock_timestamp()
);
create index enrollment_domain_audit_entity on public.enrollment_domain_audit(entity_type,entity_id,occurred_at);
comment on table public.enrollment_domain_audit is
  'Trazabilidad sin FK destructiva. No incluir credenciales, documentos ni datos de facturación en valores.';

create table public.enrollment_funnel_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid,
  event text not null check(event in ('registered','verified','schedule_chosen','reserved','paid','expired')),
  dedup_key text not null unique check(length(dedup_key) between 1 and 200),
  occurred_at timestamptz not null default clock_timestamp()
);
create index enrollment_funnel_events_enrollment on public.enrollment_funnel_events(enrollment_id,event);

create table private.enrollment_backfill_069 (
  entity_type text not null check(entity_type in ('enrollment','reservation','cohort')),
  entity_id uuid not null,
  before_value jsonb not null,
  after_value jsonb not null,
  evidence jsonb not null,
  applied_at timestamptz not null default clock_timestamp(),
  rolled_back_at timestamptz,
  primary key(entity_type,entity_id)
);

alter table public.enrollments
  add column practice_start_date date,
  add column practice_end_date date,
  add column access_end_date date,
  add column paid_amount_centavos bigint check(paid_amount_centavos>=0),
  add column individual_dates_source text check(individual_dates_source in ('practice_plan','reservation_holds','practice_slots','approved_exception')),
  add column individual_dates_guard_ready boolean not null default false,
  add constraint enrollments_individual_dates_order check(
    (practice_start_date is null and practice_end_date is null and access_end_date is null)
    or (practice_start_date is not null and practice_end_date is not null and access_end_date is not null
      and isfinite(practice_start_date) and isfinite(practice_end_date) and isfinite(access_end_date)
      and practice_start_date<=practice_end_date and practice_end_date<=access_end_date)),
  add constraint enrollments_dates_ready_evidence check(not individual_dates_guard_ready or
    (practice_start_date is not null and individual_dates_source is not null));
create index enrollments_individual_dates on public.enrollments(cohort_id,practice_start_date,practice_end_date)
  where practice_start_date is not null;

alter table public.student_schedule_reservations
  add column precio_snapshot_centavos bigint check(precio_snapshot_centavos>=0),
  add column precio_snapshot_source text check(precio_snapshot_source in ('payment_snapshot','reservation_creation')),
  add column precio_snapshot_at timestamptz,
  add column practice_start_date date,
  add column practice_end_date date,
  add column admission_at timestamptz,
  add column admission_rule_version text,
  add constraint reservation_individual_dates_order check(
    (practice_start_date is null and practice_end_date is null) or
    (practice_start_date is not null and practice_end_date is not null
      and isfinite(practice_start_date) and isfinite(practice_end_date) and practice_start_date<=practice_end_date)),
  add constraint reservation_price_evidence check(
    (precio_snapshot_centavos is null and precio_snapshot_source is null and precio_snapshot_at is null)
    or (precio_snapshot_centavos is not null and precio_snapshot_source is not null and precio_snapshot_at is not null));
create index reservations_individual_dates on public.student_schedule_reservations(cohort_id,practice_start_date,practice_end_date)
  where estado in ('vigente','pago_en_curso');

-- Sin DEFAULT de código aún: 069 lo asigna a filas existentes sin alterar lectores legacy.
alter table public.cohorts add column codigo text,
  add column habilitada boolean not null default true,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.users(id) on delete restrict,
  add column cancellation_reason text,
  add constraint cohorts_cancellation_shape check(
    (cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or (cancelled_at is not null and cancelled_by is not null and cancellation_reason is not null
      and length(btrim(cancellation_reason))>0));
create unique index cohorts_codigo_unique on public.cohorts(codigo) where codigo is not null;
create index cohorts_cancelled_by on public.cohorts(cancelled_by) where cancelled_by is not null;

-- Defensa ante privilegios por defecto del proyecto. Sin acceso desde navegador.
do $$ declare t text; begin
 foreach t in array array['public.course_type_prices','public.enrollment_rule_flags',
   'public.enrollment_plan_options','public.enrollment_admin_permissions','public.enrollment_domain_audit',
   'public.enrollment_funnel_events','private.enrollment_backfill_069'] loop
   execute format('alter table %s enable row level security',t);
   execute format('revoke all on %s from public,anon,authenticated,service_role',t);
   execute format('grant select on %s to service_role',t);
 end loop;
end $$;
-- Solo lectura para la aplicación en lote 1. Escrituras mediante scripts manuales revisados.

-- Herramientas de evidencia, no reglas de admisión. Ninguna lectura de precio/fechas de cohorte.
create function private.lote1_date(p_value text) returns date
language plpgsql immutable security invoker set search_path='' as $$
declare d date; begin
 if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
 d:=p_value::date;
 if not isfinite(d) or to_char(d,'YYYY-MM-DD')<>p_value then return null; end if;
 return d;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end $$;

create view private.lote1_enrollment_evidence with(security_invoker=true) as
with plans as (
 select e.id,
   count(*) filter(where private.lote1_date(d.value#>>'{}') is not null) valid_days,
   count(*) total_days,
   min(private.lote1_date(d.value#>>'{}')) start_date,
   max(private.lote1_date(d.value#>>'{}')) end_date
 from public.enrollments e cross join lateral jsonb_array_elements(
   case when jsonb_typeof(e.practice_plan->'fechas')='array' then e.practice_plan->'fechas' else '[]'::jsonb end) d
 group by e.id
), confirmed as (
 select r.enrollment_id,count(distinct r.id) reservations,count(h.id) hold_count,
   min((h.scheduled_at at time zone 'America/Guayaquil')::date) start_date,
   max((h.scheduled_at at time zone 'America/Guayaquil')::date) end_date
 from public.student_schedule_reservations r left join public.student_schedule_holds h on h.reservation_id=r.id
 where r.estado='confirmada' group by r.enrollment_id
), slots as (
 select e.id,count(s.id) slot_count,
   min((s.scheduled_at at time zone 'America/Guayaquil')::date) start_date,
   max((s.scheduled_at at time zone 'America/Guayaquil')::date) end_date,
   (select count(*) from public.enrollments other where other.student_id=e.student_id and other.cohort_id=e.cohort_id) associations
 from public.enrollments e left join public.practice_slots s
   on s.student_id=e.student_id and s.cohort_id=e.cohort_id and s.status<>'sin_practica'
 group by e.id
), paid as (
 select enrollment_id,count(*) payment_count,sum(total_centavos) amount,
   jsonb_agg(id order by id) payment_ids
 from public.payments where estado='aprobado' group by enrollment_id
), candidates as (
 select e.id,e.student_id,e.status,e.course_type,e.etapa_inscripcion,
   case when p.valid_days=p.total_days and p.valid_days>0 then p.start_date end plan_start,
   case when p.valid_days=p.total_days and p.valid_days>0 then p.end_date end plan_end,
   case when c.reservations=1 and c.hold_count=coalesce(e.horas_practica_objetivo,case when e.practice_plan->>'horas' ~ '^[0-9]{1,4}$' then (e.practice_plan->>'horas')::integer end)
     then c.start_date end holds_start,
   case when c.reservations=1 and c.hold_count=coalesce(e.horas_practica_objetivo,case when e.practice_plan->>'horas' ~ '^[0-9]{1,4}$' then (e.practice_plan->>'horas')::integer end)
     then c.end_date end holds_end,
   sl.slot_count,sl.associations slot_associations,sl.start_date slots_start,sl.end_date slots_end,
   case when sl.associations=1 and sl.slot_count=coalesce(e.horas_practica_objetivo,
     case when e.practice_plan->>'horas' ~ '^[0-9]{1,4}$' then (e.practice_plan->>'horas')::integer end)
     and sl.slot_count>0 then sl.start_date end proven_slots_start,
   case when sl.associations=1 and sl.slot_count=coalesce(e.horas_practica_objetivo,
     case when e.practice_plan->>'horas' ~ '^[0-9]{1,4}$' then (e.practice_plan->>'horas')::integer end)
     and sl.slot_count>0 then sl.end_date end proven_slots_end,
   coalesce(p.total_days,0) plan_days,coalesce(p.valid_days,0) valid_plan_days,
   coalesce(c.reservations,0) confirmed_reservations,coalesce(c.hold_count,0) hold_count,
   coalesce(a.payment_count,0) payment_count,a.amount payment_amount,
   (e.monto_abonado*100)::bigint legacy_paid_amount,a.payment_ids,
   md5(coalesce(e.practice_plan::text,'null')) plan_hash
 from public.enrollments e left join slots sl on sl.id=e.id
 left join plans p on p.id=e.id left join confirmed c on c.enrollment_id=e.id
 left join paid a on a.enrollment_id=e.id
)
select *,
 case when confirmed_reservations>1 then 'ambiguous_confirmed_reservations'
   when confirmed_reservations=1 and hold_count>0 and holds_start is null then 'incomplete_confirmed_holds'
   when plan_start is not null and holds_start is not null
     and (plan_start<>holds_start or plan_end<>holds_end) then 'conflicting_dates'
   when plan_days<>valid_plan_days then 'invalid_plan_dates'
   when slot_count>0 and slot_associations<>1 then 'ambiguous_practice_slot_ownership'
   when slot_count>0 and proven_slots_start is null then 'incomplete_practice_slots'
   when proven_slots_start is not null and coalesce(plan_start,holds_start) is not null
     and (proven_slots_start<>coalesce(plan_start,holds_start) or proven_slots_end<>coalesce(plan_end,holds_end)) then 'conflicting_dates'
   when plan_start is null and holds_start is null and proven_slots_start is null then 'missing_proven_dates'
   else null end date_issue,
 case when payment_count>1 or (payment_count=1 and payment_amount<>legacy_paid_amount)
   then 'conflicting_paid_amount' else null end money_issue,
 coalesce(plan_start,holds_start,proven_slots_start) proposed_start,
 coalesce(plan_end,holds_end,proven_slots_end) proposed_end,
 case when plan_start is not null then 'practice_plan' when holds_start is not null then 'reservation_holds' when proven_slots_start is not null then 'practice_slots' end proposed_source,
 case when payment_count=1 and payment_amount=legacy_paid_amount then payment_amount
   when payment_count=0 then legacy_paid_amount else null end proposed_paid_amount
from candidates;

create view private.lote1_reservation_evidence with(security_invoker=true) as
with evidence as (
 select r.id,r.enrollment_id,r.estado,
   min((h.scheduled_at at time zone 'America/Guayaquil')::date) first_hold_date,
   max((h.scheduled_at at time zone 'America/Guayaquil')::date) last_hold_date,
   count(h.id) hold_count,
   coalesce(e.horas_practica_objetivo,case when e.practice_plan->>'horas' ~ '^[0-9]{1,4}$'
     then (e.practice_plan->>'horas')::integer end) expected_slot_count,
   (select count(distinct p.subtotal_centavos) from public.payments p where p.reservation_id=r.id) price_count,
   (select min(p.subtotal_centavos) from public.payments p where p.reservation_id=r.id) proposed_price,
   (select min(p.created_at) from public.payments p where p.reservation_id=r.id) price_evidence_at
 from public.student_schedule_reservations r join public.enrollments e on e.id=r.enrollment_id
 left join public.student_schedule_holds h on h.reservation_id=r.id
 group by r.id,e.id
)
select *,
 case when hold_count>0 and hold_count=expected_slot_count then first_hold_date end proposed_start,
 case when hold_count>0 and hold_count=expected_slot_count then last_hold_date end proposed_end
from evidence;

create view private.lote1_preflight_cases with(security_invoker=true) as
select 'enrollment'::text entity_type,id entity_id,date_issue issue,
 jsonb_build_object('planDays',plan_days,'validPlanDays',valid_plan_days,'planHash',plan_hash,
   'confirmedReservations',confirmed_reservations,'holdCount',hold_count,
   'planStart',plan_start,'planEnd',plan_end,'holdsStart',holds_start,'holdsEnd',holds_end,
   'slotCount',slot_count,'slotAssociations',slot_associations,'slotsStart',slots_start,'slotsEnd',slots_end) evidence
from private.lote1_enrollment_evidence where date_issue is not null
union all
select 'enrollment',id,money_issue,jsonb_build_object('payments',payment_ids,
 'paymentAmount',payment_amount,'legacyPaidAmount',legacy_paid_amount)
from private.lote1_enrollment_evidence where money_issue is not null
union all
select 'reservation',id,'missing_or_ambiguous_price',jsonb_build_object('distinctPrices',price_count)
from private.lote1_reservation_evidence where price_count<>1
union all
select 'reservation',id,'missing_holds',jsonb_build_object('holdCount',hold_count)
from private.lote1_reservation_evidence where hold_count=0
union all
select 'reservation',id,'incomplete_reservation_holds',jsonb_build_object('holdCount',hold_count,
 'expectedSlotCount',expected_slot_count,'firstHoldDate',first_hold_date,'lastHoldDate',last_hold_date)
from private.lote1_reservation_evidence where hold_count>0 and proposed_start is null
union all
select 'cohort',id,'invalid_date_chain',jsonb_build_object('enrollmentStart',fecha_inicio_matricula,
 'enrollmentEnd',fecha_fin_matricula,'courseStart',fecha_inicio_curso,'courseEnd',fecha_fin_curso)
from public.cohorts where not(fecha_inicio_matricula<=fecha_fin_matricula and
 fecha_fin_matricula<=fecha_fin_curso and fecha_inicio_curso<=fecha_fin_curso)
union all
select 'cohort',id,'duplicate_normalized_name',jsonb_build_object('conflictingIds',ids)
from (select id,count(*) over(partition by lower(regexp_replace(normalize(btrim(nombre),NFD),U&'[\0300-\036f]','','g'))) n,
 jsonb_agg(id) over(partition by lower(regexp_replace(normalize(btrim(nombre),NFD),U&'[\0300-\036f]','','g'))) ids
 from public.cohorts) names where n>1;
revoke all on function private.lote1_date(text) from public,anon,authenticated;
revoke all on private.lote1_enrollment_evidence,private.lote1_reservation_evidence,
 private.lote1_preflight_cases from public,anon,authenticated,service_role;
grant execute on function private.lote1_date(text) to service_role;
grant select on private.lote1_enrollment_evidence,private.lote1_reservation_evidence,
 private.lote1_preflight_cases to service_role;
$foundation_068$;
 end if;
end $resume_068$;
commit;
