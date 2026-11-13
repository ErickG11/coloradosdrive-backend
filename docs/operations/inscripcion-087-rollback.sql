begin;
set local lock_timeout='5s';
do $guard$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.assign_pending_enrollment_cohort_with_reason_v13(uuid,uuid,uuid,uuid,timestamp with time zone,date,text)')) is distinct from '6689f2145928f10c3e49dded961b9c57' then raise exception 'ROLLBACK_087: asignación auditada con cuerpo desconocido';end if;
end $guard$;
do $guard$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.enrollment_has_access_v2(uuid)')) is distinct from 'bd6b761932fa1e3deb81deb78face079' then raise exception 'GUARDA_087: private.enrollment_has_access_v2(uuid) no coincide con el cuerpo esperado';end if;
end $guard$;
do $guard$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.legacy079_enrollment_has_access_v2(uuid)')) is distinct from '3739c28486fc809ee4ad81dfe16c27d4' then raise exception 'GUARDA_087: private.legacy079_enrollment_has_access_v2(uuid) no coincide con el cuerpo esperado';end if;
end $guard$;
do $guard$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('cancel_cohort_v2(uuid,uuid,timestamp with time zone,text)')) is distinct from '4180a0cfc343941461145181241fcec4' then raise exception 'GUARDA_087: cancel_cohort_v2(uuid,uuid,timestamp with time zone,text) no coincide con el cuerpo esperado';end if;
end $guard$;
create or replace function private.legacy079_enrollment_has_access_v2(p_enrollment uuid) returns boolean language sql volatile security invoker set search_path='' as $$
 select coalesce((select e.status in('activo','finalizado') and e.etapa_inscripcion='activa' and(not e.individual_dates_guard_ready or(e.practice_start_date is not null and e.access_end_date is not null and e.monto_total is not null and e.paid_amount_centavos>=round(e.monto_total*100)::bigint and private.cohortes_now()>=e.practice_start_date::timestamp at time zone 'America/Guayaquil' and private.cohortes_now()<(e.access_end_date+1)::timestamp at time zone 'America/Guayaquil')) from public.enrollments e where e.id=p_enrollment),false) $$;
CREATE OR REPLACE FUNCTION public.cancel_cohort_v2(p_actor uuid, p_cohort uuid, p_version timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ declare c public.cohorts;begin
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
end $function$
;
do $guard$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('admin_enrollment_management_v12(uuid,uuid,uuid)')) is distinct from 'b73535818cbd26be3dfd416f0f704989' then raise exception 'ROLLBACK_087: destinos de matrícula con cuerpo desconocido';end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.admin_enrollment_management_v12(p_actor uuid, p_student uuid, p_enrollment uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare e public.enrollments;destinations jsonb;begin
 if not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then perform private.raise_cohort_error('PERMISO_REQUERIDO');end if;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student;if not found then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 if private.enrollment_rule_enabled('schedule_changes') and exists(select 1 from public.enrollment_admin_permissions where admin_id=p_actor and permission='reassign_schedules' and revoked_at is null) then
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.nombre,'from',c.fecha_inicio_curso,'to',c.fecha_fin_curso,'capacity',c.cupo_maximo,'occupied',private.cohort_peak_v2(c.id,coalesce(e.practice_start_date,c.fecha_inicio_curso),coalesce(e.practice_end_date,c.fecha_fin_curso),e.id),
 'fits',e.practice_start_date>=c.fecha_inicio_curso and e.practice_end_date<=c.fecha_fin_curso,
 'reason',case when private.cohortes_now()>=(c.fecha_fin_curso+1)::timestamp at time zone 'America/Guayaquil' then 'El destino está terminado.' when not c.habilitada or c.cancelled_at is not null then 'El destino no está habilitado.' when e.practice_start_date is null or e.practice_end_date is null then 'Faltan fechas individuales demostrables; resolver preflight.' when e.practice_start_date<c.fecha_inicio_curso or e.practice_end_date>c.fecha_fin_curso then 'El plan no cabe; requiere excepción explícita y motivo.' when not(private.cohort_calendar_v2(c.fecha_inicio_matricula,c.fecha_fin_matricula,c.fecha_inicio_curso,c.fecha_fin_curso,c.habilitada,private.cohortes_now())->>'open')::boolean then 'La matrícula está cerrada; requiere excepción explícita y motivo.' when private.cohort_peak_v2(c.id,e.practice_start_date,e.practice_end_date,e.id)>=c.cupo_maximo then 'Sin cupo en el intervalo del alumno.' else 'El plan cabe.' end) order by c.fecha_inicio_curso,c.id),'[]') into destinations
 from public.cohorts c join public.courses cu on cu.id=c.course_id where cu.tipo=e.course_type;
 end if;
 return jsonb_build_object('version',e.updated_at,'documentsEnabled',private.enrollment_rule_enabled('identity') and exists(select 1 from public.enrollment_admin_permissions where admin_id=p_actor and permission='verify_identity' and revoked_at is null),
 'transferEnabled',private.enrollment_rule_enabled('schedule_changes') and(e.origen='manual' or e.etapa_inscripcion='activa') and e.status in('activo','pendiente_cohorte'),'destinations',coalesce(destinations,'[]'));
end $function$
;
drop function public.assign_pending_enrollment_cohort_with_reason_v13(uuid,uuid,uuid,uuid,timestamptz,date,text);
commit;
