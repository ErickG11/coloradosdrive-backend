-- L7: previsualización transaccional y reasignación todo o nada; sin sobrecupo.
begin;
set local lock_timeout='5s';
create or replace function public.assert_reassignment_permission_v2(p_actor uuid) returns void language sql volatile security invoker set search_path='' as $$select private.require_enrollment_permission(p_actor,'reassign_schedules')$$;
create or replace function public.reserve_admin_plan_change_v2(p_actor uuid,p_enrollment uuid,p_input jsonb,p_reason text,p_target uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare student uuid;begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');
 select student_id into student from public.enrollments where id=p_enrollment;
 if not found then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 return private.reserve_plan_change_v2(student,p_enrollment,p_input,p_actor,p_reason,true,p_target);
end $$;
create or replace function public.confirm_admin_plan_change_v2(p_actor uuid,p_reservation uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare student uuid;begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');
 select student_id into student from public.student_schedule_reservations where id=p_reservation;
 if not found then perform private.raise_cohort_error('RESERVA_NO_ENCONTRADA');end if;
 return private.confirm_plan_change_v2(student,p_reservation,p_actor);
end $$;
create or replace function public.admin_plan_change_state_v2(p_actor uuid,p_enrollment uuid) returns jsonb language plpgsql security invoker set search_path='' as $$ declare student uuid;begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');select student_id into student from public.enrollments where id=p_enrollment;
 if not found then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 return private.plan_change_state_v2(student,p_enrollment,p_actor);
end $$;
create or replace function public.release_admin_plan_change_v2(p_actor uuid,p_student uuid,p_reservation uuid) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');
 if not exists(select 1 from public.student_schedule_reservations where id=p_reservation and student_id=p_student and replacement_enrollment_id is not null) then perform private.raise_cohort_error('RESERVA_NO_ENCONTRADA');end if;
 return private.manage_reservation_v2(p_student,'liberar',p_reservation);
end $$;
create or replace function public.preview_admin_plan_change_v2(p_actor uuid,p_enrollment uuid,p_input jsonb,p_reason text,p_target uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare student uuid;result jsonb;begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');
 select student_id into student from public.enrollments where id=p_enrollment;
 if not found then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 begin result:=private.reserve_plan_change_v2(student,p_enrollment,p_input,p_actor,p_reason,true,p_target);raise exception using errcode='P7601';
 exception when sqlstate 'P7601' then return jsonb_build_object('franjas',result->'franjas','precioCentavos',result->'precioCentavos','serverNow',result->'serverNow','factible',true);end;
end $$;

create or replace function public.admin_plan_change_calendar_v2(p_actor uuid,p_enrollment uuid,p_month date,p_mode text,p_hours integer,p_target uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare student uuid;begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');select student_id into student from public.enrollments where id=p_enrollment;
 if not found then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 return private.change_calendar_v2(student,p_enrollment,p_month,p_mode,p_hours,p_actor,p_target);
end $$;

create or replace function public.bulk_reassign_enrollments_v2(p_actor uuid,p_changes jsonb,p_reason text,p_preview boolean default true)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare entry jsonb;student uuid;reservation jsonb;results jsonb:='[]';ids uuid[];begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');
 if not private.enrollment_rule_enabled('schedule_changes') then perform private.raise_cohort_error('PLAN_CAMBIO_REGLAS_INACTIVAS');end if;
 if jsonb_typeof(p_changes) is distinct from 'array' then perform private.raise_cohort_error('PLAN_REASIGNACION_ENTRADA_INVALIDA');end if;
 if jsonb_array_length(p_changes) not between 1 and 100
 or p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_preview is null then perform private.raise_cohort_error('PLAN_REASIGNACION_ENTRADA_INVALIDA');end if;
 if exists(select 1 from jsonb_array_elements(p_changes) x where jsonb_typeof(x)<>'object' or (coalesce(x->>'enrollmentId','') !~ '^[0-9a-fA-F-]{36}$' or coalesce(x->>'updatedAt','')='')) then
 perform private.raise_cohort_error('PLAN_REASIGNACION_ENTRADA_INVALIDA');end if;
 select array_agg((x->>'enrollmentId')::uuid order by(x->>'enrollmentId')::uuid) into ids from jsonb_array_elements(p_changes) x;
 if(select count(distinct id) from unnest(ids) id)<>cardinality(ids) then perform private.raise_cohort_error('PLAN_REASIGNACION_ENTRADA_INVALIDA');end if;
 -- Todos los sujetos/matrículas antes de cohortes y bloqueo global: el mismo
 -- orden de reserva individual, sin retener locks parciales entre alumnos.
 perform 1 from public.users where id in(select student_id from public.enrollments where id=any(ids)) order by id for update;
 perform 1 from public.enrollments where id=any(ids) order by id for update;
 if(select count(*) from public.enrollments where id=any(ids))<>cardinality(ids) then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 perform 1 from public.cohorts order by id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 begin
  for entry in select value from jsonb_array_elements(p_changes) order by value->>'enrollmentId' loop
   select student_id into student from public.enrollments where id=(entry->>'enrollmentId')::uuid;
   if (select updated_at from public.enrollments where id=(entry->>'enrollmentId')::uuid) is distinct from(entry->>'updatedAt')::timestamptz then perform private.raise_cohort_error('PLAN_CAMBIO_VERSION_CONFLICTO');end if;
   reservation:=private.reserve_plan_change_v2(student,(entry->>'enrollmentId')::uuid,entry-'enrollmentId'-'cohortId'-'updatedAt',p_actor,p_reason,true,nullif(entry->>'cohortId','')::uuid);
   reservation:=private.confirm_plan_change_v2(student,(reservation->>'id')::uuid,p_actor);
   results:=results||jsonb_build_array(jsonb_build_object('enrollmentId',entry->>'enrollmentId','reservation',reservation));
  end loop;
  if p_preview then raise exception using errcode='P7700';end if;
 exception when sqlstate 'P7700' then return jsonb_build_object('preview',true,'canApply',true,'plans',results);end;
 return jsonb_build_object('preview',false,'canApply',true,'plans',results);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.raise_cohort_error('PLAN_REASIGNACION_ENTRADA_INVALIDA');
end $$;

create or replace function public.cancel_cohort_v2(p_actor uuid,p_cohort uuid,p_version timestamptz,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare c public.cohorts;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('cohort_admin') then perform private.raise_cohort_error('COHORTE_REGLAS_INACTIVAS');end if;
 select * into c from public.cohorts where id=p_cohort for update;
 if not found then perform private.raise_cohort_error('COHORTE_NO_ENCONTRADA');end if;
 if c.updated_at is distinct from p_version then perform private.raise_cohort_error('COHORTE_VERSION_CONFLICTO');end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then perform private.raise_cohort_error('COHORTE_ENTRADA_INVALIDA');end if;
 if c.cancelled_at is not null then return jsonb_build_object('id',c.id,'cancelled',true);end if;
 if exists(select 1 from public.enrollments where cohort_id=c.id and status='activo')
 or exists(select 1 from public.student_schedule_reservations where cohort_id=c.id and(estado='pago_en_curso' or(estado='vigente' and expira_at>private.cohortes_now()))) then
 perform private.raise_cohort_error('COHORTE_CANCELACION_BLOQUEADA');end if;
 perform set_config('cohortes.actor',p_actor::text,true);perform set_config('cohortes.reason',p_reason,true);
 update public.cohorts set habilitada=false,cancelled_at=private.cohortes_now(),cancelled_by=p_actor,cancellation_reason=p_reason where id=c.id;
 return jsonb_build_object('id',c.id,'cancelled',true);
end $$;

create or replace function public.cohort_reassignment_source_v2(p_actor uuid,p_cohort uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare c public.cohorts;begin
 if not private.enrollment_rule_enabled('schedule_changes') then return jsonb_build_object('active',false);end if;
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');
 select * into c from public.cohorts where id=p_cohort;
 if not found then perform private.raise_cohort_error('COHORTE_NO_ENCONTRADA');end if;
 return jsonb_build_object('active',true,'serverNow',private.cohortes_now(),'cohort',jsonb_build_object('id',c.id,'type',(select tipo from public.courses where id=c.course_id)),
 'enrollments',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'studentId',e.student_id,'studentName',u.nombre_completo,
  'practiceStartDate',e.practice_start_date,'practiceEndDate',e.practice_end_date,'updatedAt',e.updated_at,'guardReady',e.individual_dates_guard_ready) order by u.nombre_completo,e.id),'[]')
 from public.enrollments e join public.users u on u.id=e.student_id where e.cohort_id=p_cohort and e.status='activo'));
end $$;

-- La regla nueva permite historia de la misma cohorte tras una excepción.
-- Con indicadores apagados se restituye la restricción heredada, o se bloquea
-- la desactivación para que el operador resuelva el rollback sin borrar filas.
alter function private.enrollment_access_activation() rename to legacy077_enrollment_access_activation;
create function private.enrollment_access_activation() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if new.key='enrollment_access' and new.enabled is distinct from old.enabled then
  if new.enabled then
   drop index if exists public.enrollments_one_active_per_student;
   alter table public.enrollments drop constraint if exists enrollments_student_cohort_unique;
  else
   if exists(select 1 from public.enrollments where status in ('activo','pendiente_cohorte') group by student_id having count(*)>1) then perform private.raise_cohort_error('MATRICULA_ROLLBACK_CONVIVENCIA');end if;
   if exists(select 1 from public.enrollments where cohort_id is not null group by student_id,cohort_id having count(*)>1) then perform private.raise_cohort_error('MATRICULA_ROLLBACK_HISTORIAL');end if;
   create unique index if not exists enrollments_one_active_per_student on public.enrollments(student_id) where status in ('activo','pendiente_cohorte');
   if not exists(select 1 from pg_constraint where conrelid='public.enrollments'::regclass and conname='enrollments_student_cohort_unique') then
    alter table public.enrollments add constraint enrollments_student_cohort_unique unique(student_id,cohort_id);end if;
  end if;
 end if;return new;
end $$;
drop trigger enrollment_access_activation on public.enrollment_rule_flags;
create trigger enrollment_access_activation before update on public.enrollment_rule_flags for each row execute function private.enrollment_access_activation();

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in('enrollment_access_activation','legacy077_enrollment_access_activation')) or
 (n.nspname='public' and p.proname in('admin_plan_change_calendar_v2','preview_admin_plan_change_v2','release_admin_plan_change_v2','assert_reassignment_permission_v2','reserve_admin_plan_change_v2','confirm_admin_plan_change_v2','admin_plan_change_state_v2','bulk_reassign_enrollments_v2','cancel_cohort_v2','cohort_reassignment_source_v2')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
update public.enrollment_rule_flags set implemented=true,enabled=false where key='schedule_changes';
notify pgrst,'reload schema';
commit;
