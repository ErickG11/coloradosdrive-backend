-- L6. Marca por alumno/tipo y outbox en notifications existente; ninguna tabla nueva.
begin;
set local lock_timeout='5s';
alter table public.users add column if not exists enrollment_waitlist jsonb not null default '{}'::jsonb;
alter table public.notifications add column if not exists waitlist_type public.course_type,
 add column if not exists waitlist_event_day date,add column if not exists waitlist_registered_at timestamptz,add column if not exists waitlist_registration_id uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_waitlist_shape') then
  alter table public.notifications add constraint notifications_waitlist_shape check(tipo<>'espera_apertura' or(waitlist_type is not null and waitlist_event_day is not null and waitlist_registered_at is not null and waitlist_registration_id is not null));
 end if;
end $$;
create unique index if not exists notifications_waitlist_event on public.notifications(user_id,waitlist_type,waitlist_event_day) where waitlist_type is not null;
do $$ declare expression text;begin
 select pg_get_expr(conbin,conrelid) into expression from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_tipo_check';
 if expression is not null and position('espera_apertura' in expression)=0 then
  alter table public.notifications drop constraint notifications_tipo_check;
  execute format('alter table public.notifications add constraint notifications_tipo_check check ((%s) or tipo=%L)',expression,'espera_apertura');
 end if;
end $$;
create or replace function public.set_enrollment_waitlist_v2(p_student uuid,p_type public.course_type,p_preference jsonb default null,p_remove boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare u public.users;entry jsonb;begin
 select * into u from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then perform private.raise_cohort_error('ESPERA_CUENTA_NO_HABILITADA');end if;
 if not private.enrollment_rule_enabled('waitlist') then perform private.raise_cohort_error('ESPERA_REGLAS_INACTIVAS');end if;
 if p_type is null or p_remove is null or(p_preference is not null and(jsonb_typeof(p_preference)<>'object' or length(p_preference::text)>500)) then
  perform private.raise_cohort_error('ESPERA_ENTRADA_INVALIDA');end if;
 if p_preference is not null and(exists(select 1 from jsonb_object_keys(p_preference) k where k not in('modalidad','horasPorDia','horaInicio'))
 or(p_preference?'modalidad' and p_preference->>'modalidad' not in('entre_semana','fin_de_semana'))
 or(p_preference?'horasPorDia' and coalesce(p_preference->>'horasPorDia','') !~ '^[1-6]$')
 or(p_preference?'horaInicio' and coalesce(p_preference->>'horaInicio','') !~ '^(0?[6-9]|1[0-9]|2[01])$')) then perform private.raise_cohort_error('ESPERA_ENTRADA_INVALIDA');end if;
 if p_remove then
  update public.users set enrollment_waitlist=enrollment_waitlist-p_type::text where id=p_student;
  update public.notifications set email_status='fallido',email_last_error='ESPERA_RETIRO_SOLICITADO' where user_id=p_student and waitlist_type=p_type and email_status='pendiente' and email_lease_token is null;
  return jsonb_build_object('registered',false);end if;
 entry:=coalesce(u.enrollment_waitlist->p_type::text,jsonb_build_object('registeredAt',private.cohortes_now(),'registrationId',gen_random_uuid(),'preference',p_preference));
 update public.users set enrollment_waitlist=jsonb_set(enrollment_waitlist,array[p_type::text],entry) where id=p_student;
 return jsonb_build_object('registered',true,'registeredAt',entry->'registeredAt');
end $$;
create or replace function public.get_enrollment_waitlist_v2(p_student uuid) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('waitlist') then return jsonb_build_object('active',false,'types','{}'::jsonb);end if;
 if not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo) then perform private.raise_cohort_error('ESPERA_CUENTA_NO_HABILITADA');end if;
 return jsonb_build_object('active',true,'types',(select enrollment_waitlist from public.users where id=p_student),'enrollments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',course_type)),'[]') from public.enrollments where student_id=p_student and status in ('activo','pendiente_cohorte')));
end $$;
create or replace function private.waitlist_cohort_available_v2(p_cohort uuid) returns boolean language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare c public.cohorts;d date;opt record;h integer;plan jsonb;slots timestamptz[];t timestamptz;free boolean;begin
 select * into c from public.cohorts where id=p_cohort;
 if not found or c.cancelled_at is not null or not c.habilitada then return false;end if;
 if not (private.cohort_calendar_v2(c.fecha_inicio_matricula,c.fecha_fin_matricula,c.fecha_inicio_curso,c.fecha_fin_curso,c.habilitada,private.cohortes_now())->>'open')::boolean then return false;end if;
 for d in select generate_series(greatest(c.fecha_inicio_curso,(private.cohortes_now() at time zone 'America/Guayaquil')::date),c.fecha_fin_curso,interval '1 day')::date loop
  for opt in select * from public.enrollment_plan_options where habilitada and ((modalidad='fin_de_semana')=(extract(isodow from d) in (6,7))) order by horas_por_dia desc loop
   for h in 6..22-opt.horas_por_dia loop
    plan:=private.enrollment_plan_v2(jsonb_build_object('fechaInicio',d,'modalidad',opt.modalidad,'horasPorDia',opt.horas_por_dia,'horaInicio',h));
    if (plan->>'ultimaFecha')::date>c.fecha_fin_curso or private.cohort_peak_v2(c.id,d,(plan->>'ultimaFecha')::date)>=c.cupo_maximo then continue;end if;
    select array_agg(value::timestamptz order by value) into slots from jsonb_array_elements_text(plan->'franjas');
    if slots[1]<=private.cohortes_now() then continue;end if;
    free:=true;
    foreach t in array slots loop if not exists(select 1 from private.free_instructors_v2(array[t])) then free:=false;exit;end if;end loop;
    if free then return true;end if;
   end loop;
  end loop;
 end loop;return false;
end $$;
create or replace function public.preview_waitlist_event_v2(p_actor uuid,p_cohort uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare v_type public.course_type;n integer:=0;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('waitlist') then return jsonb_build_object('count',0);end if;
 select cu.tipo into v_type from public.cohorts c join public.courses cu on cu.id=c.course_id where c.id=p_cohort;
 if not found then perform private.raise_cohort_error('COHORTE_NO_ENCONTRADA');end if;
 if private.waitlist_cohort_available_v2(p_cohort) then
 select count(*) into n from public.users where rol='estudiante' and activo and enrollment_waitlist?v_type::text
 and not exists(select 1 from public.notifications where user_id=users.id and waitlist_type=v_type and waitlist_event_day=(private.cohortes_now() at time zone 'America/Guayaquil')::date);
 end if;return jsonb_build_object('count',n,'type',v_type,'day',(private.cohortes_now() at time zone 'America/Guayaquil')::date);
end $$;
create or replace function public.enqueue_waitlist_event_v2(p_actor uuid,p_cohort uuid) returns integer
language plpgsql security invoker set search_path='' as $$ declare offer jsonb;tipo public.course_type;day date;n integer;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('waitlist') then perform private.raise_cohort_error('ESPERA_REGLAS_INACTIVAS');end if;
 perform 1 from public.cohorts where id=p_cohort for share;
 offer:=public.preview_waitlist_event_v2(p_actor,p_cohort);
 if (offer->>'count')::integer=0 then return 0;end if;
 tipo:=(offer->>'type')::public.course_type;day:=(offer->>'day')::date;
 insert into public.notifications(user_id,tipo,titulo,mensaje,email_status,waitlist_type,waitlist_event_day,waitlist_registered_at,waitlist_registration_id,email_next_attempt_at)
 select u.id,'espera_apertura','Hay horarios disponibles para tu inscripción',
 'Puedes consultar fechas y precio en Mi inscripción. La asignación está sujeta a cupos disponibles.',
 'pendiente',tipo,day,(u.enrollment_waitlist->tipo::text->>'registeredAt')::timestamptz,(u.enrollment_waitlist->tipo::text->>'registrationId')::uuid,
 clock_timestamp()+row_number() over(order by (u.enrollment_waitlist->tipo::text->>'registeredAt')::timestamptz,u.id)*interval '1 microsecond'
 from public.users u where rol='estudiante' and activo and u.enrollment_waitlist?tipo::text
 on conflict(user_id,waitlist_type,waitlist_event_day) where waitlist_type is not null do nothing;
 get diagnostics n=row_count;return n;
end $$;
create or replace function private.waitlist_email_delivered_v2() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if new.tipo='espera_apertura' and new.email_status='enviado' and old.email_status is distinct from 'enviado' then
 update public.users set enrollment_waitlist=enrollment_waitlist-new.waitlist_type::text where id=new.user_id
 and (enrollment_waitlist->new.waitlist_type::text->>'registrationId')::uuid=new.waitlist_registration_id;
 end if;
 if new.tipo='espera_apertura' and new.email_status='fallido' and new.email_last_error is distinct from 'ESPERA_RETIRO_SOLICITADO' then
  insert into public.notifications(user_id,tipo,titulo,mensaje,domain_code,domain_entity_id,domain_severity,domain_last_seen_at)
  select u.id,'cambio_realizado','Aviso de apertura sin entregar','Revisar el proveedor de correo y reintentar la cola. La marca del alumno se conserva.',
  'ESPERA_CORREO_FALLIDO',new.id,'alta',clock_timestamp()
  from public.users u join public.enrollment_admin_permissions a on a.admin_id=u.id and a.permission='manage_cohorts_prices' and a.revoked_at is null where u.rol='admin' and u.activo
  on conflict(user_id,domain_code,domain_entity_id) where domain_code is not null and domain_resolved_at is null do update set domain_last_seen_at=excluded.domain_last_seen_at,
  read_at=case when public.notifications.domain_last_seen_at<clock_timestamp()-interval '1 day' then null else public.notifications.read_at end;
 elsif new.tipo='espera_apertura' and new.email_status='enviado' then
  update public.notifications set domain_resolved_at=clock_timestamp() where domain_code='ESPERA_CORREO_FALLIDO' and domain_entity_id=new.id and domain_resolved_at is null;
 end if;return new;
end $$;
drop trigger if exists notifications_waitlist_delivered on public.notifications;
create trigger notifications_waitlist_delivered after update of email_status on public.notifications for each row execute function private.waitlist_email_delivered_v2();
create or replace function public.admin_waitlist_counts_v2(p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('waitlist') then return jsonb_build_object('active',false,'A',0,'B',0);end if;
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 return jsonb_build_object('active',true,'A',(select count(*) from public.users where rol='estudiante' and activo and enrollment_waitlist?'A'),
 'B',(select count(*) from public.users where rol='estudiante' and activo and enrollment_waitlist?'B'));
end $$;
-- El filtro se aplica antes de paginar dentro del listado existente.
alter function public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer) set schema private;
alter function private.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer) rename to legacy075_list_admin_students;
do $$ declare definition text;begin
 select pg_get_functiondef('private.legacy075_list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'::regprocedure) into definition;
 definition:=replace(definition,'private.legacy075_list_admin_students','public.list_admin_students');
 definition:=replace(definition,$pattern$where u.rol='estudiante' and (p_active$pattern$,
 $replacement$where u.rol='estudiante' and (not private.enrollment_rule_enabled('waitlist') or coalesce(current_setting('cohortes.waitlist_filter',true),'')='' or (u.activo and u.enrollment_waitlist?current_setting('cohortes.waitlist_filter',true))) and (p_active$replacement$);
 execute definition;
end $$;
create or replace function public.list_admin_waitlist_students_v2(p_actor uuid,p_type public.course_type,p_filters jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$ begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('waitlist') then perform private.raise_cohort_error('ESPERA_REGLAS_INACTIVAS');end if;
 perform set_config('cohortes.waitlist_filter',p_type::text,true);
 return public.list_admin_students(p_actor,p_filters->>'q',(p_filters->>'activo')::boolean,(p_filters->>'courseId')::uuid,(p_filters->>'cohortId')::uuid,
 (p_filters->>'pendienteCohorte')::boolean,(p_filters->>'documentosPendientes')::boolean,coalesce((p_filters->>'incluirHistorial')::boolean,false),coalesce((p_filters->>'page')::integer,1),coalesce((p_filters->>'pageSize')::integer,20));
end $$;
create or replace function public.retry_waitlist_emails_v2(p_actor uuid,p_type public.course_type,p_reason text) returns integer
language plpgsql security invoker set search_path='' as $$ declare n integer;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('waitlist') then perform private.raise_cohort_error('ESPERA_REGLAS_INACTIVAS');end if;
 if p_type is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then perform private.raise_cohort_error('ESPERA_ENTRADA_INVALIDA');end if;
 update public.notifications n set email_status='pendiente',email_attempts=0,email_next_attempt_at=clock_timestamp(),email_lease_token=null,email_locked_until=null,email_last_error=null
 where n.tipo='espera_apertura' and n.waitlist_type=p_type and n.email_status='fallido' and exists(select 1 from public.users u where u.id=n.user_id and u.activo and u.enrollment_waitlist?p_type::text and(u.enrollment_waitlist->p_type::text->>'registrationId')::uuid=n.waitlist_registration_id);
 get diagnostics n=row_count;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason)
 values(p_actor,'waitlist_email_retry','course_type',p_type::text,jsonb_build_object('retried',n),p_reason);return n;
end $$;
revoke all on function public.retry_waitlist_emails_v2(uuid,public.course_type,text) from public,anon,authenticated;
grant execute on function public.retry_waitlist_emails_v2(uuid,public.course_type,text) to service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in('waitlist_cohort_available_v2','waitlist_email_delivered_v2','legacy075_list_admin_students')) or
 (n.nspname='public' and p.proname in('set_enrollment_waitlist_v2','get_enrollment_waitlist_v2','preview_waitlist_event_v2','enqueue_waitlist_event_v2','admin_waitlist_counts_v2','list_admin_waitlist_students_v2','list_admin_students')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
update public.enrollment_rule_flags set implemented=true,enabled=false where key='waitlist';
notify pgrst,'reload schema';
commit;
