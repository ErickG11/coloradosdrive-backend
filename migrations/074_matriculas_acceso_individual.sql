-- L5. El valor enum se conserva en rollback funcional; no reescribir tablas históricas.
begin;
alter type public.enrollment_status add value if not exists 'anulada';
commit;
begin;
set local lock_timeout='5s';
alter table public.enrollments add column if not exists access_extended_by uuid references public.users(id) on delete restrict,
 add column if not exists access_extended_at timestamptz,add column if not exists access_extension_reason text;
alter table public.enrollments drop constraint enrollments_pendiente_cohorte_shape;
alter table public.enrollments add constraint enrollments_pendiente_cohorte_shape check (status::text='anulada' or
 (etapa_inscripcion='activa' and reserva_expira_at is null and
   ((status='pendiente_cohorte' and cohort_id is null and monto_total is null)
    or (status<>'pendiente_cohorte' and cohort_id is not null and monto_total is not null)))
 or (origen='solicitud' and etapa_inscripcion in ('por_agendar','reservado')
  and status='pendiente_cohorte' and monto_total is null and monto_abonado=0 and descuento=0
  and ((etapa_inscripcion='por_agendar' and cohort_id is null and reserva_expira_at is null)
   or (etapa_inscripcion='reservado' and cohort_id is not null and reserva_expira_at is not null
    and isfinite(reserva_expira_at)))));
-- Este índice no sustituye el guard global hasta activar enrollment_access.
create unique index if not exists enrollments_one_current_per_type on public.enrollments(student_id,course_type)
 where status in ('activo','pendiente_cohorte');
create or replace function private.enrollment_access_activation() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if new.key='enrollment_access' and new.enabled is distinct from old.enabled then
  if new.enabled then drop index if exists public.enrollments_one_active_per_student;
  else
   if exists(select 1 from public.enrollments where status in ('activo','pendiente_cohorte') group by student_id having count(*)>1) then
    perform private.raise_cohort_error('MATRICULA_ROLLBACK_CONVIVENCIA');end if;
   create unique index if not exists enrollments_one_active_per_student on public.enrollments(student_id) where status in ('activo','pendiente_cohorte');
  end if;
 end if;return new;
end $$;
drop trigger if exists enrollment_access_activation on public.enrollment_rule_flags;
create trigger enrollment_access_activation before update on public.enrollment_rule_flags for each row execute function private.enrollment_access_activation();

create or replace function private.enrollment_current_guard() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('enrollment_access') then return new;end if;
 if new.status in ('activo','pendiente_cohorte') and (tg_op='INSERT' or old.status not in ('activo','pendiente_cohorte')) then
  perform 1 from public.users where id=new.student_id for update;
  if exists(select 1 from public.enrollments where student_id=new.student_id and course_type=new.course_type and id<>new.id and status in ('activo','pendiente_cohorte')) then
   perform private.raise_cohort_error('MATRICULA_TIPO_VIGENTE');end if;
  if exists(select 1 from public.enrollments where student_id=new.student_id and course_type=new.course_type and id<>new.id and status='finalizado')
    and coalesce(current_setting('cohortes.repeat_student',true),'')<>new.student_id::text then
   perform private.raise_cohort_error('MATRICULA_REPETICION_REQUIERE_EXCEPCION');end if;
 end if;
 return new;
end $$;
drop trigger if exists enrollments_00_current_guard on public.enrollments;
create trigger enrollments_00_current_guard before insert or update of student_id,course_type,status on public.enrollments for each row execute function private.enrollment_current_guard();

create or replace function private.enrollment_has_access_v2(p_enrollment uuid) returns boolean
language sql volatile security invoker set search_path='' as $$
 select coalesce((select e.status in ('activo','finalizado') and e.etapa_inscripcion='activa' and
  (not e.individual_dates_guard_ready or(
   e.practice_start_date is not null and e.access_end_date is not null and e.paid_amount_centavos is not null
   and private.cohortes_now()>=e.practice_start_date::timestamp at time zone 'America/Guayaquil'
   and private.cohortes_now()<(e.access_end_date+1)::timestamp at time zone 'America/Guayaquil'))
  from public.enrollments e where e.id=p_enrollment),false)
$$;
create or replace function public.student_enrollment_access_v2(p_student uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$ begin
 if not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo) then perform private.raise_cohort_error('MATRICULA_CUENTA_NO_HABILITADA');end if;
 return jsonb_build_object('active',private.enrollment_rule_enabled('enrollment_access'),'serverNow',private.cohortes_now(),'enrollments',
 (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'courseId',e.course_id,'type',e.course_type,'status',e.status,
 'eligible',private.enrollment_has_access_v2(e.id),'practiceStartDate',e.practice_start_date,'practiceEndDate',e.practice_end_date,'accessEndDate',e.access_end_date,'guardReady',e.individual_dates_guard_ready,'paidAmountCentavos',e.paid_amount_centavos,'datesSource',e.individual_dates_source) order by e.created_at,e.id),'[]')
 from public.enrollments e where student_id=p_student));
end $$;

alter function private.content_student_eligible(uuid,uuid) rename to legacy074_content_student_eligible;
create function private.content_student_eligible(p_student uuid,p_course uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('enrollment_access') then return private.legacy074_content_student_eligible(p_student,p_course);end if;
 return exists(select 1 from public.users u join public.enrollments e on e.student_id=u.id where u.id=p_student and u.rol='estudiante' and u.activo and not u.debe_cambiar_password
 and e.course_id=p_course and private.enrollment_has_access_v2(e.id)
 and not exists(select 1 from public.student_deletion_operations d where d.student_id=u.id and d.status<>'completo'));
end $$;

create or replace function public.extend_enrollment_access_v2(p_actor uuid,p_enrollment uuid,p_end date,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare e public.enrollments;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('enrollment_access') then perform private.raise_cohort_error('MATRICULA_REGLAS_INACTIVAS');end if;
 select * into e from public.enrollments where id=p_enrollment for update;
 if not found then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 if e.status not in ('activo','finalizado') or e.etapa_inscripcion<>'activa' or not e.individual_dates_guard_ready then perform private.raise_cohort_error('MATRICULA_ACCESO_ESTADO_INVALIDO');end if;
 if p_end is null or not isfinite(p_end) or p_end<e.access_end_date or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
  perform private.raise_cohort_error('MATRICULA_EXTENSION_INVALIDA');end if;
 update public.enrollments set access_end_date=p_end,access_extended_by=p_actor,access_extended_at=private.cohortes_now(),access_extension_reason=p_reason where id=e.id;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
 values(p_actor,'access_extended','enrollment',e.id::text,jsonb_build_object('access_end_date',e.access_end_date),jsonb_build_object('access_end_date',p_end),p_reason);
 return jsonb_build_object('id',e.id,'accessEndDate',p_end);
end $$;
create or replace function public.authorize_repeat_enrollment_v2(p_actor uuid,p_student uuid,p_course uuid,p_reason text) returns uuid
language plpgsql security invoker set search_path='' as $$ declare tipo public.course_type;result uuid;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('enrollment_access') then perform private.raise_cohort_error('MATRICULA_REGLAS_INACTIVAS');end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then perform private.raise_cohort_error('MATRICULA_CUENTA_NO_HABILITADA');end if;
 select c.tipo into tipo from public.courses c where c.id=p_course;
 if not found then perform private.raise_cohort_error('COHORTE_CURSO_NO_ENCONTRADO');end if;
 if not exists(select 1 from public.enrollments where student_id=p_student and course_type=tipo and status='finalizado') then perform private.raise_cohort_error('MATRICULA_REPETICION_ESTADO_INVALIDO');end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then perform private.raise_cohort_error('MATRICULA_EXTENSION_INVALIDA');end if;
 perform set_config('cohortes.repeat_student',p_student::text,true);
 insert into public.enrollments(student_id,course_id,course_type,status,origen,etapa_inscripcion,horas_practica_objetivo)
 values(p_student,p_course,tipo,'pendiente_cohorte','solicitud','por_agendar',15) returning id into result;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason)
 values(p_actor,'repeat_enrollment_authorized','enrollment',result::text,jsonb_build_object('studentId',p_student,'courseType',tipo),p_reason);
 return result;
end $$;
create or replace function public.admin_enrollment_access_v2(p_actor uuid,p_student uuid) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('enrollment_access') then return jsonb_build_object('active',false,'serverNow',private.cohortes_now(),'enrollments','[]'::jsonb);end if;
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not exists(select 1 from public.users where id=p_student and rol='estudiante') then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 return jsonb_build_object('active',private.enrollment_rule_enabled('enrollment_access'),'serverNow',private.cohortes_now(),'enrollments',
 (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'courseId',e.course_id,'type',e.course_type,'status',e.status,'eligible',private.enrollment_has_access_v2(e.id),
 'practiceStartDate',e.practice_start_date,'practiceEndDate',e.practice_end_date,'accessEndDate',e.access_end_date,'guardReady',e.individual_dates_guard_ready,
 'paidAmountCentavos',e.paid_amount_centavos,'datesSource',e.individual_dates_source) order by e.created_at,e.id),'[]') from public.enrollments e where student_id=p_student));
end $$;
revoke all on function public.admin_enrollment_access_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_enrollment_access_v2(uuid,uuid) to service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in ('enrollment_access_activation','enrollment_current_guard','enrollment_has_access_v2','content_student_eligible','legacy074_content_student_eligible'))
 or(n.nspname='public' and p.proname in ('student_enrollment_access_v2','extend_enrollment_access_v2','authorize_repeat_enrollment_v2')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
update public.enrollment_rule_flags set implemented=true,enabled=false where key='enrollment_access';
notify pgrst,'reload schema';
commit;
