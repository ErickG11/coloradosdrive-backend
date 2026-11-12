-- L3. Capacidad única por instructor y vehículos globales; reservas por tipo.
begin;
set local lock_timeout='5s';
-- GUARDA-MD5 INICIO (hash congelado de la instalación local; md5(replace(prosrc,chr(13),'')))
do $guard$declare g record;begin
 for g in select * from (values
  ('public.enforce_cohort_cupo()','fb206807a6af638c97ae8af4491f81e8'),
  ('public.expire_student_reservations(uuid)','dee7f7a6bd097bd1b62b49467981e3db'),
  ('public.guard_practice_schedule_holds()','93b17173fdbacc1de16e0e47fd788862'),
  ('public.manage_student_reservation(uuid,text,uuid,integer,integer,integer)','e5c6872eb70629565ff7fe838ae74109'),
  ('public.release_inactive_student_reservations()','43f99de5401a3cb42c634546f96dc185'),
  ('public.reserve_student_schedule(uuid,uuid,timestamp with time zone[],text,date,integer,integer,integer,integer)','520896c23a6fdb334f072af836011bde')
 ) v(sig,h) loop
  if to_regprocedure(g.sig) is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(g.sig)) is distinct from g.h then
   raise exception 'GUARDA_071: % no coincide con el cuerpo esperado; no se aplica la migración',g.sig;
  end if;
 end loop;
end $guard$;
-- GUARDA-MD5 FIN
alter table public.app_settings add column if not exists vehiculos_disponibles integer check(vehiculos_disponibles>=0),
 add column if not exists reserva_ttl_minutos integer not null default 15 check(reserva_ttl_minutos>0),
 add column if not exists reservas_expiradas_dia integer not null default 3 check(reservas_expiradas_dia>0),
 add column if not exists reserva_cooldown_segundos integer not null default 60 check(reserva_cooldown_segundos>=0);
-- Sin valor de vehículos inventado. La activación exige configuración explícita.
do $$ begin if not exists(select 1 from pg_constraint where conrelid='public.enrollments'::regclass and conname='enrollments_id_course_type_unique') then alter table public.enrollments add constraint enrollments_id_course_type_unique unique(id,course_type);end if;end $$;
alter table public.student_schedule_reservations add column if not exists course_type public.course_type;
update public.student_schedule_reservations r set course_type=e.course_type from public.enrollments e where e.id=r.enrollment_id;
alter table public.student_schedule_reservations alter column course_type set not null;
do $$ begin if not exists(select 1 from pg_constraint where conrelid='public.student_schedule_reservations'::regclass and conname='reservations_enrollment_type_fk') then alter table public.student_schedule_reservations add constraint reservations_enrollment_type_fk foreign key(enrollment_id,course_type) references public.enrollments(id,course_type) on delete cascade;end if;end $$;
drop index public.student_schedule_one_live;
create unique index student_schedule_one_live on public.student_schedule_reservations(student_id,course_type) where estado in ('vigente','pago_en_curso');
alter table public.student_schedule_holds add column if not exists payment_protected boolean not null default false,
 add column if not exists resource_until timestamptz generated always as (case when payment_protected then 'infinity'::timestamptz else expira_at end) stored;
do $$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.student_schedule_holds'::regclass and contype='x' loop
  execute format('alter table public.student_schedule_holds drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.student_schedule_holds add constraint schedule_holds_resource_exclusion exclude using gist(
 instructor_id with =,
 tsrange(scheduled_at at time zone 'UTC',(scheduled_at at time zone 'UTC')+interval '1 hour','[)') with &&,
 tstzrange(held_from,resource_until,'[)') with &&) where(released_at is null);
create index if not exists schedule_holds_slot_live on public.student_schedule_holds(scheduled_at,instructor_id) where released_at is null;

create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$ select clock_timestamp() $$;
create or replace function private.cohort_peak_v2(p_cohort uuid,p_start date,p_end date,p_exclude uuid default null)
returns integer language plpgsql volatile security invoker set search_path='' as $$
declare n integer;begin
 if exists(select 1 from public.enrollments e where e.cohort_id=p_cohort and e.status='activo' and e.etapa_inscripcion='activa'
 and (p_exclude is null or e.id<>p_exclude) and(e.practice_start_date is null or e.practice_end_date is null)) then
  return 2147483647;end if;
 with commitments as (
  select e.id enrollment_id,e.practice_start_date a,e.practice_end_date+1 b from public.enrollments e
   where e.cohort_id=p_cohort and e.status='activo' and e.etapa_inscripcion='activa' and (p_exclude is null or e.id<>p_exclude)
  union all
  select r.enrollment_id,r.practice_start_date,r.practice_end_date+1 from public.student_schedule_reservations r
   where r.cohort_id=p_cohort and r.estado in ('vigente','pago_en_curso') and(r.expira_at>private.cohortes_now() or r.estado='pago_en_curso')
    and(p_exclude is null or r.enrollment_id<>p_exclude)
 ), merged as (
  select enrollment_id,range_agg(daterange(a,b,'[)')) ranges from commitments
  where a is not null and b is not null and a<=p_end and b>p_start group by enrollment_id
 ), intervals as (select unnest(ranges) r from merged), events as (
  select greatest(lower(r),p_start) d,1 delta from intervals
  union all select least(upper(r),p_end+1),-1 from intervals
 ), totals as (select d,sum(delta) delta from events group by d), running as(
  select d,sum(delta) over(order by d) n from totals
 ) select coalesce(max(running.n) filter(where d<=p_end),0)::integer into n from running;
 return n;
end $$;
create or replace function private.vehicle_occupation_v2(p_at timestamptz,p_skip_slot uuid default null,p_skip_reservation uuid default null)
returns integer language sql volatile security invoker set search_path='' as $$
 select (select count(*) from public.practice_slots s where s.id is distinct from p_skip_slot
   and s.student_id is not null and s.status in ('asignado','confirmado','completado')
   and tsrange(s.scheduled_at at time zone 'UTC',(s.scheduled_at at time zone 'UTC')+interval '1 hour','[)')
    && tsrange(p_at at time zone 'UTC',(p_at at time zone 'UTC')+interval '1 hour','[)'))::integer
 + (select count(*) from public.student_schedule_holds h where h.reservation_id is distinct from p_skip_reservation
   and h.released_at is null and(h.payment_protected or h.expira_at>private.cohortes_now())
   and tsrange(h.scheduled_at at time zone 'UTC',(h.scheduled_at at time zone 'UTC')+interval '1 hour','[)')
    && tsrange(p_at at time zone 'UTC',(p_at at time zone 'UTC')+interval '1 hour','[)'))::integer
$$;
create or replace function private.free_instructors_v2(p_slots timestamptz[],p_student uuid default null,p_skip_reservation uuid default null)
returns table(id uuid,nombre_completo text) language sql volatile security invoker set search_path='' as $$
 select u.id,u.nombre_completo from public.users u where u.rol='instructor' and u.activo
 and not exists(select 1 from public.practice_slots s cross join unnest(p_slots) t
  where s.instructor_id=u.id and s.status in ('disponible','asignado','confirmado','liberado','completado')
  and not(s.student_id is null and s.status in ('disponible','liberado') and s.scheduled_at=t)
  and tsrange(s.scheduled_at at time zone 'UTC',(s.scheduled_at at time zone 'UTC')+interval '1 hour','[)')
    && tsrange(t at time zone 'UTC',(t at time zone 'UTC')+interval '1 hour','[)'))
 and not exists(select 1 from public.student_schedule_holds h cross join unnest(p_slots) t
  where h.instructor_id=u.id and h.reservation_id is distinct from p_skip_reservation and h.released_at is null
   and(h.payment_protected or h.expira_at>private.cohortes_now())
   and tsrange(h.scheduled_at at time zone 'UTC',(h.scheduled_at at time zone 'UTC')+interval '1 hour','[)')
    && tsrange(t at time zone 'UTC',(t at time zone 'UTC')+interval '1 hour','[)'))
 and not exists(select 1 from unnest(p_slots) t where private.vehicle_occupation_v2(t,null,p_skip_reservation)>=
  coalesce((select vehiculos_disponibles from public.app_settings where id),0))
 order by
  (select count(*) from public.practice_slots s where s.instructor_id=u.id and s.student_id=p_student)
    +(select count(*) from public.student_schedule_holds h join public.student_schedule_reservations r on r.id=h.reservation_id
      where h.instructor_id=u.id and r.student_id=p_student and h.released_at is null
        and(h.payment_protected or h.expira_at>private.cohortes_now())) desc,
  (select count(*) from public.practice_slots s where s.instructor_id=u.id and
   (s.scheduled_at at time zone 'America/Guayaquil')::date=(p_slots[1] at time zone 'America/Guayaquil')::date)
   +(select count(*) from public.student_schedule_holds h where h.instructor_id=u.id and h.released_at is null
    and(h.payment_protected or h.expira_at>private.cohortes_now()) and
    (h.scheduled_at at time zone 'America/Guayaquil')::date=(p_slots[1] at time zone 'America/Guayaquil')::date),u.id
$$;
create or replace function private.reservation_type_v2() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 select course_type into new.course_type from public.enrollments where id=new.enrollment_id and student_id=new.student_id;
 if new.course_type is null then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 return new;
end $$;
drop trigger if exists reservations_00_type on public.student_schedule_reservations;
create trigger reservations_00_type before insert or update of enrollment_id,student_id on public.student_schedule_reservations
 for each row execute function private.reservation_type_v2();

create or replace function private.reservation_json_v2(p_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $$
 select jsonb_build_object('id',r.id,'enrollmentId',r.enrollment_id,'estado',r.estado,'expiraAt',r.expira_at,
 'serverNow',private.cohortes_now(),'extensiones',r.extensiones,'puedeAmpliar',false,
 'precioCentavos',r.precio_snapshot_centavos,'franjas',(select coalesce(jsonb_agg(jsonb_build_object('scheduledAt',h.scheduled_at) order by h.scheduled_at),'[]')
 from public.student_schedule_holds h where h.reservation_id=r.id)) from public.student_schedule_reservations r where r.id=p_id
$$;
create or replace function private.close_reservation_v2(p_id uuid,p_state text) returns void
language plpgsql security invoker set search_path='' as $$ declare r public.student_schedule_reservations;begin
 if p_state not in ('vencida','liberada') then perform private.raise_cohort_error('RESERVA_ACCION_INVALIDA');end if;
 select * into r from public.student_schedule_reservations where id=p_id for update;
 if not found or r.estado not in ('vigente','pago_en_curso') then return;end if;
 if r.estado='pago_en_curso' then perform private.raise_cohort_error('PAGO_EN_PROCESO');end if;
 update public.student_schedule_holds set released_at=private.cohortes_now(),payment_protected=false where reservation_id=p_id and released_at is null;
 update public.student_schedule_reservations set estado=p_state,cerrada_at=private.cohortes_now() where id=p_id;
 update public.enrollments set etapa_inscripcion='por_agendar',cohort_id=null,reserva_expira_at=null where id=r.enrollment_id and etapa_inscripcion='reservado';
 insert into public.student_schedule_events(reservation_id,accion) values(p_id,p_state);
end $$;
create or replace function private.expire_reservations_v2(p_student uuid) returns integer
language plpgsql security invoker set search_path='' as $$ declare r record;n integer:=0;begin
 perform 1 from public.users where id=p_student for update;
 perform 1 from public.enrollments where student_id=p_student order by id for update;
 for r in select id from public.student_schedule_reservations where student_id=p_student and estado='vigente'
  and expira_at<=private.cohortes_now() order by id for update loop
  perform private.close_reservation_v2(r.id,'vencida');n:=n+1;
 end loop;
 return n;
end $$;
create or replace function private.reserve_schedule_v2(p_student uuid,p_enrollment uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.enrollments;c public.cohorts;r public.student_schedule_reservations;
 plan jsonb;slots timestamptz[];t timestamptz;i uuid;v_now timestamptz;v_end timestamptz;
 cfg public.app_settings;price bigint;v_start date;v_last date;v_count int;v_last_expired timestamptz;
begin
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 perform private.assert_student_not_deleting(p_student);
 perform private.expire_reservations_v2(p_student);
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student for update;
 if not found then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 select * into r from public.student_schedule_reservations where student_id=p_student and course_type=e.course_type
  and estado in ('vigente','pago_en_curso') for update;
 if found then return private.reservation_json_v2(r.id);end if;
 if e.status<>'pendiente_cohorte' or e.etapa_inscripcion<>'por_agendar' or e.requisitos_verificados_at is null then
  perform private.raise_cohort_error('RESERVA_ESTADO_NO_PERMITIDO');end if;
 plan:=private.enrollment_plan_v2(p_input);perform private.assert_enrollment_plan_future(plan,private.cohortes_now());
 if not exists(select 1 from public.enrollment_plan_options where modalidad=p_input->>'modalidad'
  and horas_por_dia=(p_input->>'horasPorDia')::int and habilitada) then
  perform private.raise_cohort_error('PLAN_OPCION_NO_OFERTADA');end if;
 select array_agg(value::timestamptz order by value::timestamptz) into slots from jsonb_array_elements_text(plan->'franjas');
 v_start:=(plan->>'fechaInicioEfectiva')::date;v_last:=(plan->>'ultimaFecha')::date;
 -- Bloquear candidatas en orden estable; elegir después por fin e id.
 perform 1 from public.cohorts co join public.courses cu on cu.id=co.course_id where cu.tipo=e.course_type order by co.id for update of co;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 v_now:=private.cohortes_now();perform private.assert_enrollment_plan_future(plan,v_now);
 select * into cfg from public.app_settings where id;
 if cfg.vehiculos_disponibles is null then perform private.raise_cohort_error('CAPACIDAD_CONFIG_REQUERIDA');end if;
 select precio_centavos into price from public.course_type_prices where tipo=e.course_type;
 if price is null then perform private.raise_cohort_error('PAGO_PRECIO_NO_CONFIGURADO');end if;
 select count(*),max(cerrada_at) into v_count,v_last_expired from public.student_schedule_reservations
  where student_id=p_student and estado='vencida' and
   (cerrada_at at time zone 'America/Guayaquil')::date=(v_now at time zone 'America/Guayaquil')::date;
 if v_count>=cfg.reservas_expiradas_dia or(v_count>0 and v_last_expired+make_interval(secs=>cfg.reserva_cooldown_segundos)>v_now) then
  perform private.raise_cohort_error('RESERVA_LIMITE_EXPIRADAS');end if;
 select co.* into c from public.cohorts co join public.courses cu on cu.id=co.course_id
  where cu.tipo=e.course_type and co.habilitada and co.cancelled_at is null
  and co.fecha_inicio_matricula<=co.fecha_fin_matricula and co.fecha_fin_matricula<=co.fecha_fin_curso
  and v_now>=co.fecha_inicio_matricula::timestamp at time zone 'America/Guayaquil'
  and v_now<(co.fecha_fin_matricula-4)::timestamp at time zone 'America/Guayaquil'
  and v_start>=co.fecha_inicio_curso and v_last<=co.fecha_fin_curso
  and private.cohort_peak_v2(co.id,v_start,v_last,e.id)<co.cupo_maximo
  order by co.fecha_fin_curso,co.id limit 1;
 if not found then perform private.raise_cohort_error('RESERVA_SIN_HORARIOS');end if;
 if exists(select 1 from public.practice_slots s cross join unnest(slots) requested(slot_at) where s.student_id=p_student
   and s.status in ('asignado','confirmado','completado') and abs(extract(epoch from(s.scheduled_at-requested.slot_at)))<3600) then
  perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO');end if;
 v_end:=v_now+make_interval(mins=>cfg.reserva_ttl_minutos);
 insert into public.student_schedule_reservations(student_id,enrollment_id,cohort_id,course_type,creada_at,expira_at,
 modalidad,fecha_inicio,horas_por_dia,margen_dias,practice_start_date,practice_end_date,
 precio_snapshot_centavos,precio_snapshot_source,precio_snapshot_at,admission_at,admission_rule_version)
 values(p_student,e.id,c.id,e.course_type,v_now,v_end,p_input->>'modalidad',v_start,(p_input->>'horasPorDia')::int,0,
 v_start,v_last,price,'reservation_creation',v_now,v_now,'070') returning * into r;
 foreach t in array slots loop
  select id into i from private.free_instructors_v2(array[t],p_student,null) limit 1;
  if i is null then perform private.raise_cohort_error('RESERVA_RECURSO_OCUPADO');end if;
  perform 1 from public.users where id=i and rol='instructor' and activo for share;
  if not found then perform private.raise_cohort_error('CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE');end if;
  insert into public.student_schedule_holds(reservation_id,instructor_id,scheduled_at,held_from,expira_at)
   values(r.id,i,t,v_now,v_end);
 end loop;
 update public.enrollments set etapa_inscripcion='reservado',course_id=c.course_id,cohort_id=c.id,reserva_expira_at=v_end,
   practice_start_date=v_start,practice_end_date=v_last,access_end_date=v_last,
   individual_dates_source='reservation_holds',horas_practica_objetivo=15 where id=e.id;
 insert into public.student_schedule_events(reservation_id,accion) values(r.id,'reservada');
 return private.reservation_json_v2(r.id);
end $$;

-- Detalles públicos sin nombre/código de cohorte. La consulta no concede ni retiene cupo.
create or replace function public.student_schedule_preview_v2(p_student uuid,p_enrollment uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.enrollments;c public.cohorts;plan jsonb;slots timestamptz[];t timestamptz;
 free boolean;all_free boolean:=true;days jsonb:='[]';d jsonb;bad jsonb:='[]';cfg public.app_settings;
begin
 if not private.enrollment_rule_enabled('reservations') then perform private.raise_cohort_error('RESERVA_REGLAS_INACTIVAS');end if;
 if not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo) then
  perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student;
 if not found then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 plan:=private.enrollment_plan_v2(p_input);perform private.assert_enrollment_plan_future(plan,private.cohortes_now());
 select array_agg(value::timestamptz order by value::timestamptz) into slots from jsonb_array_elements_text(plan->'franjas');
 select * into cfg from public.app_settings where id;
 if cfg.vehiculos_disponibles is null then perform private.raise_cohort_error('CAPACIDAD_CONFIG_REQUERIDA');end if;
 select co.* into c from public.cohorts co join public.courses cu on cu.id=co.course_id
 where cu.tipo=e.course_type and co.habilitada and co.cancelled_at is null
  and co.fecha_inicio_matricula<=co.fecha_fin_matricula and co.fecha_fin_matricula<=co.fecha_fin_curso
  and private.cohortes_now()>=co.fecha_inicio_matricula::timestamp at time zone 'America/Guayaquil'
  and private.cohortes_now()<(co.fecha_fin_matricula-4)::timestamp at time zone 'America/Guayaquil'
  and (plan->>'fechaInicioEfectiva')::date>=co.fecha_inicio_curso and (plan->>'ultimaFecha')::date<=co.fecha_fin_curso
  and private.cohort_peak_v2(co.id,(plan->>'fechaInicioEfectiva')::date,(plan->>'ultimaFecha')::date,e.id)<co.cupo_maximo
 order by co.fecha_fin_curso,co.id limit 1;
 for d in select value from jsonb_array_elements(plan->'dias') loop
  free:=c.id is not null and exists(select 1 from public.enrollment_plan_options where modalidad=p_input->>'modalidad'
   and horas_por_dia=(p_input->>'horasPorDia')::integer and habilitada);
  foreach t in array slots loop
   if (t at time zone 'America/Guayaquil')::date<>(d->>'fecha')::date then continue;end if;
   if not exists(select 1 from private.free_instructors_v2(array[t],p_student,null)) or exists(
    select 1 from public.practice_slots ps where ps.student_id=p_student and ps.status in ('asignado','confirmado','completado')
      and abs(extract(epoch from(ps.scheduled_at-t)))<3600) then free:=false;end if;
  end loop;
  if not free then bad:=bad||jsonb_build_array(d->>'fecha');all_free:=false;end if;
  days:=days||jsonb_build_array(d||jsonb_build_object('disponible',free));
 end loop;
 return plan||jsonb_build_object('dias',days,'factible',all_free,'diasFallan',bad,'serverNow',private.cohortes_now(),
  'precioCentavos',(select precio_centavos from public.course_type_prices where tipo=e.course_type));
end $$;

create or replace function private.manage_reservation_v2(p_student uuid,p_action text,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.student_schedule_reservations;begin
 if p_action not in ('actual','liberar','ampliar','iniciar_pago') then perform private.raise_cohort_error('RESERVA_ACCION_INVALIDA');end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 perform private.expire_reservations_v2(p_student);
 select * into r from public.student_schedule_reservations where student_id=p_student and(p_id is null or id=p_id)
 order by creada_at desc,id limit 1 for update;
 if not found then
  if p_action='actual' then return null;end if;
  perform private.raise_cohort_error('RESERVA_NO_ENCONTRADA');
 end if;
 if p_action='actual' or r.estado not in ('vigente','pago_en_curso') then return private.reservation_json_v2(r.id);end if;
 if p_action='ampliar' then perform private.raise_cohort_error('RESERVA_NO_AMPLIABLE');end if;
 if p_action='liberar' then
  if r.estado='pago_en_curso' then perform private.raise_cohort_error('PAGO_EN_PROCESO');end if;
  perform private.close_reservation_v2(r.id,'liberada');
 elsif p_action='iniciar_pago' then
  perform 1 from public.cohorts where id=r.cohort_id for update;
  perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
  if r.estado='vigente' and r.expira_at<=private.cohortes_now() then
   perform private.close_reservation_v2(r.id,'vencida');return private.reservation_json_v2(r.id);end if;
  update public.student_schedule_holds set payment_protected=true where reservation_id=r.id and released_at is null;
  update public.student_schedule_reservations set estado='pago_en_curso',pago_iniciado_at=coalesce(pago_iniciado_at,private.cohortes_now()) where id=r.id;
 end if;
 return private.reservation_json_v2(r.id);
end $$;

-- Mantener las implementaciones anteriores para flags apagados y rollback.
alter function public.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer) set schema private;
alter function private.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer) rename to legacy071_reserve_student_schedule;
create function public.reserve_student_schedule(p_student uuid,p_enrollment uuid,p_slots timestamptz[],p_modalidad text,p_inicio date,p_horas integer,
 p_ttl integer default 15,p_max_dia integer default 3,p_margen integer default 5) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare input jsonb;plan jsonb;expected timestamptz[];result jsonb;begin
 if not private.enrollment_rule_enabled('reservations') then
  return private.legacy071_reserve_student_schedule(p_student,p_enrollment,p_slots,p_modalidad,p_inicio,p_horas,p_ttl,p_max_dia,p_margen);end if;
 input:=jsonb_build_object('modalidad',p_modalidad,'fechaInicio',p_inicio,'horasPorDia',p_horas,
   'horaInicio',extract(hour from(p_slots[1] at time zone 'America/Guayaquil'))::integer);
 plan:=private.enrollment_plan_v2(input);
 select array_agg(value::timestamptz order by value::timestamptz) into expected from jsonb_array_elements_text(plan->'franjas');
 if expected is distinct from (select array_agg(t order by t) from unnest(p_slots) t) then
   perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 result:=private.reserve_schedule_v2(p_student,p_enrollment,input);return result;
end $$;
alter function public.manage_student_reservation(uuid,text,uuid,integer,integer,integer) set schema private;
alter function private.manage_student_reservation(uuid,text,uuid,integer,integer,integer) rename to legacy071_manage_student_reservation;
create function public.manage_student_reservation(p_student uuid,p_accion text,p_id uuid default null,p_extension integer default 10,
 p_max_extensiones integer default 1,p_gracia integer default 10) returns jsonb
language plpgsql security invoker set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('reservations') and not exists(select 1 from public.student_schedule_reservations where student_id=p_student and(p_id is null or id=p_id) and admission_rule_version='070' and estado in ('vigente','pago_en_curso')) then
  return private.legacy071_manage_student_reservation(p_student,p_accion,p_id,p_extension,p_max_extensiones,p_gracia);end if;
 return private.manage_reservation_v2(p_student,p_accion,p_id);
end $$;
alter function public.expire_student_reservations(uuid) set schema private;
alter function private.expire_student_reservations(uuid) rename to legacy071_expire_student_reservations;
create function public.expire_student_reservations(p_student uuid) returns integer language plpgsql security invoker set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('reservations') and not exists(select 1 from public.student_schedule_reservations where student_id=p_student and admission_rule_version='070') then return private.legacy071_expire_student_reservations(p_student);end if;
 return private.expire_reservations_v2(p_student);
end $$;

alter function public.guard_practice_schedule_holds() rename to legacy071_guard_practice_schedule_holds;
create function public.guard_practice_schedule_holds() returns trigger language plpgsql security invoker set search_path='' as $$
declare vehicles integer;begin
 if not private.enrollment_rule_enabled('capacity') then
  -- El cuerpo anterior se mantiene literalmente en la rama apagada.
  if new.status not in ('disponible','asignado','confirmado','liberado','completado') then return new;end if;
  perform 1 from public.cohorts where id=new.cohort_id for key share;
  perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
  if exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations r on r.id=h.reservation_id
   where(h.instructor_id=new.instructor_id or r.student_id=new.student_id) and h.released_at is null and(h.payment_protected or h.expira_at>clock_timestamp())
   and tsrange(h.scheduled_at at time zone 'UTC',(h.scheduled_at at time zone 'UTC')+interval '1 hour','[)')
    && tsrange(new.scheduled_at at time zone 'UTC',(new.scheduled_at at time zone 'UTC')+interval '1 hour','[)')) then
    raise exception 'Franja reservada por una inscripción' using errcode='IR409';end if;
  return new;
 end if;
 perform 1 from public.cohorts where id=new.cohort_id for key share;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 if new.student_id is null or new.status not in ('asignado','confirmado','completado') then return new;end if;
 if not exists(select 1 from public.users where id=new.instructor_id and rol='instructor' and activo) then
  perform private.raise_cohort_error('CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE');end if;
 select vehiculos_disponibles into vehicles from public.app_settings where id;
 if vehicles is null then perform private.raise_cohort_error('CAPACIDAD_CONFIG_REQUERIDA');end if;
 if private.vehicle_occupation_v2(new.scheduled_at,new.id,null)>=vehicles then
  perform private.raise_cohort_error('CAPACIDAD_VEHICULOS_AGOTADA');end if;
 if exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations r on r.id=h.reservation_id
  where(h.instructor_id=new.instructor_id or r.student_id=new.student_id) and h.released_at is null
  and(h.payment_protected or h.expira_at>private.cohortes_now()) and
  tsrange(h.scheduled_at at time zone 'UTC',(h.scheduled_at at time zone 'UTC')+interval '1 hour','[)')
   &&tsrange(new.scheduled_at at time zone 'UTC',(new.scheduled_at at time zone 'UTC')+interval '1 hour','[)')) then
  perform private.raise_cohort_error('RESERVA_RECURSO_OCUPADO');end if;
 return new;
end $$;
drop trigger practice_slots_00_schedule_holds on public.practice_slots;
create trigger practice_slots_00_schedule_holds before insert or update of scheduled_at,instructor_id,cohort_id,status,student_id
 on public.practice_slots for each row execute function public.guard_practice_schedule_holds();

alter function public.enforce_cohort_cupo() rename to legacy071_enforce_cohort_cupo;
create function public.enforce_cohort_cupo() returns trigger language plpgsql security invoker set search_path='' as $$
declare cap integer;occupied bigint;begin
 if new.cohort_id is null or not(new.status='activo' or(new.etapa_inscripcion='reservado' and new.reserva_expira_at>case when private.enrollment_rule_enabled('capacity') then private.cohortes_now() else clock_timestamp() end)) then return new;end if;
 select cupo_maximo into cap from public.cohorts where id=new.cohort_id for update;
 if not found then raise exception 'Cohorte no encontrada' using errcode='CD042';end if;
 if not private.enrollment_rule_enabled('capacity') then occupied:=public.cohort_cupo_ocupado(new.cohort_id,new.id);
 else
  perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
  if new.practice_start_date is null or new.practice_end_date is null then
   perform private.raise_cohort_error('CAPACIDAD_HISTORICO_PENDIENTE');end if;
  occupied:=private.cohort_peak_v2(new.cohort_id,new.practice_start_date,new.practice_end_date,new.id);
 end if;
 if occupied>=cap then
  if private.enrollment_rule_enabled('capacity') then perform private.raise_cohort_error('CAPACIDAD_CUPO_AGOTADO');end if;
  raise exception 'Cohorte sin cupo' using errcode='CD001';end if;
 return new;
end $$;
drop trigger enrollments_enforce_cupo on public.enrollments;
create trigger enrollments_enforce_cupo before insert or update of cohort_id,status,etapa_inscripcion,reserva_expira_at,practice_start_date,practice_end_date
 on public.enrollments for each row execute function public.enforce_cohort_cupo();

-- Desactivar una cuenta no concede un reembolso ni libera un pago incierto.
alter function public.release_inactive_student_reservations() rename to legacy071_release_inactive_student_reservations;
create function public.release_inactive_student_reservations() returns trigger language plpgsql security invoker set search_path='' as $$ declare r record;begin
 if not new.activo and old.activo and new.rol='estudiante' then
  perform 1 from public.enrollments where student_id=new.id order by id for update;
  for r in select id,admission_rule_version,estado from public.student_schedule_reservations where student_id=new.id
   and estado in ('vigente','pago_en_curso') order by id for update loop
   if r.admission_rule_version='070' then
    if r.estado='vigente' then perform private.close_reservation_v2(r.id,'liberada');end if;
   else perform private.close_student_reservation(r.id,'liberada');end if;
  end loop;
 end if;return new;
end $$;
drop trigger users_release_schedule_reservations on public.users;
create trigger users_release_schedule_reservations after update of activo on public.users for each row execute function public.release_inactive_student_reservations();

-- Calendario mensual: unión de planes factibles, sin revelar cohortes.
create or replace function public.student_schedule_calendar_v2(p_student uuid,p_enrollment uuid,p_month date,p_mode text,p_hours integer)
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare d date;h integer;ok boolean;rows jsonb:='[]';state jsonb;begin
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_mode not in ('entre_semana','fin_de_semana') or p_hours not between 1 and 6
 or p_month<date_trunc('month',private.cohortes_now() at time zone 'America/Guayaquil')::date
 or p_month>date_trunc('month',private.cohortes_now() at time zone 'America/Guayaquil')::date+interval '1 year' then
 perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 -- Autorizar incluso los meses sin días factibles.
 if not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo) then perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 if not exists(select 1 from public.enrollments where id=p_enrollment and student_id=p_student) then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 perform private.expire_reservations_v2(p_student);
 for d in select generate_series(p_month,p_month+interval '1 month'-interval '1 day',interval '1 day')::date loop
  ok:=false;
  if d>=(private.cohortes_now() at time zone 'America/Guayaquil')::date
    and ((extract(isodow from d) in (6,7))=(p_mode='fin_de_semana')) then
   for h in 6..22-p_hours loop
    begin
     state:=public.student_schedule_preview_v2(p_student,p_enrollment,jsonb_build_object('fechaInicio',d,'modalidad',p_mode,'horasPorDia',p_hours,'horaInicio',h));
     if (state->>'factible')::boolean then ok:=true;exit;end if;
    exception when sqlstate 'P7000' then
     if sqlerrm not in ('PLAN_FRANJA_PASADA','PLAN_INICIO_PASADO') then raise;end if;
    end;
   end loop;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('fecha',d,'disponible',ok));
 end loop;
 return jsonb_build_object('serverNow',private.cohortes_now(),'dias',rows);
end $$;
revoke all on function public.student_schedule_calendar_v2(uuid,uuid,date,text,integer) from public,anon,authenticated;
grant execute on function public.student_schedule_calendar_v2(uuid,uuid,date,text,integer) to service_role;

-- Las ACL de las funciones nuevas se cierran aunque el proyecto tenga defaults amplios.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where(n.nspname='private' and (p.proname like '%_v2' or p.proname like 'legacy071_%' or p.proname='cohortes_now'))
  or(n.nspname='public' and p.proname in ('reserve_student_schedule','manage_student_reservation','expire_student_reservations',
    'release_inactive_student_reservations','legacy071_release_inactive_student_reservations','student_schedule_preview_v2','guard_practice_schedule_holds','enforce_cohort_cupo')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
update public.enrollment_rule_flags set implemented=true,enabled=false where key in ('capacity','reservations','prices');
notify pgrst,'reload schema';
commit;
