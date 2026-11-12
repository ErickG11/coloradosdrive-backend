-- B / L12a: serialización por alumno y motivos de solape en todas las vías.
-- Aplicación manual después de 081; no activa indicadores ni modifica datos.
begin;
set local lock_timeout='5s';
-- GUARDA-MD5 INICIO (hash congelado de la instalación local; md5(replace(prosrc,chr(13),'')))
do $guard$declare g record;begin
 for g in select * from (values
  ('private.change_calendar_v2(uuid,uuid,date,text,integer,uuid,uuid)','bec8d2ba7edf6c08f4095c6e80167f08'),
  ('private.eligible_free_slots_for_enrollment(uuid,uuid)','7f9c8b64852a307d87e823c6ce1a8445'),
  ('private.integrated_manual_commit_v2(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamp with time zone[],uuid,jsonb,jsonb)','ad43dd6573761ee2e2b10a507316197a'),
  ('private.student_slot_guard_l11()','d8a207032b2a6384e7d55290914f416e'),
  ('public.bulk_reassign_enrollments_v2(uuid,jsonb,text,boolean)','45d98b4177a3cbfbe366817ea9954328'),
  ('public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamp with time zone[],uuid,jsonb,jsonb)','254839b2ec24189f189db0e64070fa2b'),
  ('public.manual_plan_preview_v2(uuid,public.course_type,jsonb,uuid)','d9defadf393526c107960fff0f2d1f04'),
  ('public.released_practice_slots_for_student(uuid)','bddd943824556472e48fa8d762a8aaf4'),
  ('public.student_schedule_calendar_v2(uuid,uuid,date,text,integer)','ada84afff309d48ee076ad7a511494ca'),
  ('public.student_schedule_preview_v2(uuid,uuid,jsonb)','86168626216cfd23e5e7369d00b504b5')
 ) v(sig,h) loop
  if to_regprocedure(g.sig) is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(g.sig)) is distinct from g.h then
   raise exception 'GUARDA_082: % no coincide con el cuerpo esperado; no se aplica la migración',g.sig;
  end if;
 end loop;
end $guard$;
-- GUARDA-MD5 FIN
-- Conservar definiciones y ACL actuales para rollback sin perder datos.
do $backup$ declare r record;definition text;backup text;begin
 for r in select p.oid,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='public' and p.proname in('commit_manual_enrollment','manual_plan_preview_v2','bulk_reassign_enrollments_v2','student_schedule_calendar_v2','released_practice_slots_for_student','student_schedule_preview_v2')) or
 (n.nspname='private' and p.proname in('integrated_manual_commit_v2','change_calendar_v2','student_slot_guard_l11','eligible_free_slots_for_enrollment')) loop
 backup:='backup082_'||md5(r.oid::regprocedure::text);
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=backup) then
 definition:=replace(pg_get_functiondef(r.oid),format('FUNCTION %I.%I(',r.nspname,r.proname),format('FUNCTION private.%I(',backup));execute definition;
 execute format('comment on function private.%I(%s) is %L',backup,pg_get_function_identity_arguments(r.oid),jsonb_build_object('schema',r.nspname,'name',r.proname)::text);
 execute format('revoke all on function private.%I(%s) from public,anon,authenticated',backup,pg_get_function_identity_arguments(r.oid));
 end if;end loop;end $backup$;
-- El mismo candado precede a usuarios, operación, matrícula, cohortes y bloqueo global.
do $locks$ declare r record;definition text;begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='public' and p.proname='commit_manual_enrollment') or(n.nspname='private' and p.proname='integrated_manual_commit_v2') loop
 definition:=pg_get_functiondef(r.oid);
 definition:=regexp_replace(definition,'\mbegin\M','begin if private.enrollment_rule_enabled(''reservations'') then perform private.lock_student_schedule_v12(p_student);end if;','i');execute definition;
 end loop;
 definition:=pg_get_functiondef('public.bulk_reassign_enrollments_v2(uuid,jsonb,text,boolean)'::regprocedure);
 definition:=replace(definition,'perform 1 from public.users where id in(select student_id from public.enrollments where id=any(ids))',
 'for student in select distinct student_id from public.enrollments where id=any(ids) order by student_id loop perform private.lock_student_schedule_v12(student);end loop;
 perform 1 from public.users where id in(select student_id from public.enrollments where id=any(ids))');execute definition;
 definition:=pg_get_functiondef('public.manual_plan_preview_v2(uuid,public.course_type,jsonb,uuid)'::regprocedure);
 definition:=regexp_replace(definition,' if exists\(select 1 from public.practice_slots s cross join unnest\(slots\).*?RESERVA_SOLAPE_PROPIO''\);end if;',
 ' if p_student is not null then perform private.assert_own_schedule_v12(p_student,slots);end if;','s');execute definition;
end $locks$;
-- La última defensa de escritura informa la práctica propia que causó el rechazo.
create or replace function private.student_slot_guard_l11() returns trigger language plpgsql security invoker set search_path='' as $$declare conflict jsonb;begin
 if not private.enrollment_rule_enabled('reservations') or new.student_id is null or new.status not in('asignado','confirmado','completado') then return new;end if;
 perform private.lock_student_schedule_v12(new.student_id);
 select jsonb_build_object('course',cu.nombre,'date',to_char(s.scheduled_at at time zone 'America/Guayaquil','YYYY-MM-DD'),'hour',to_char(s.scheduled_at at time zone 'America/Guayaquil','HH24:MI')) into conflict
 from public.practice_slots s join public.cohorts c on c.id=s.cohort_id join public.courses cu on cu.id=c.course_id
 where s.id is distinct from new.id and s.student_id=new.student_id and s.status in('asignado','confirmado','completado') and abs(extract(epoch from(s.scheduled_at-new.scheduled_at)))<3600 order by s.scheduled_at limit 1;
 if conflict is not null then perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO',conflict);end if;
 if exists(select 1 from public.users where id=new.student_id and identity_access_blocked_at is not null) then perform private.raise_cohort_error('SOLICITUD_ACCESO_REVOCADO');end if;return new;end $$;
create or replace function public.student_schedule_calendar_v2(p_student uuid,p_enrollment uuid,p_month date,p_mode text,p_hours integer)
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare d date;h integer;ok boolean;rows jsonb:='[]';state jsonb;conflict jsonb;begin
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_mode not in ('entre_semana','fin_de_semana') or p_hours not between 1 and 6
 or p_month<date_trunc('month',private.cohortes_now() at time zone 'America/Guayaquil')::date
 then
 perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 -- Autorizar incluso los meses sin días factibles.
 if not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo) then perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 if not exists(select 1 from public.enrollments where id=p_enrollment and student_id=p_student) then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 perform private.expire_reservations_v2(p_student);
 for d in select generate_series(p_month,p_month+interval '1 month'-interval '1 day',interval '1 day')::date loop
  ok:=false;conflict:=null;
  if d>=(private.cohortes_now() at time zone 'America/Guayaquil')::date
    and ((extract(isodow from d) in (6,7))=(p_mode='fin_de_semana')) then
   for h in 6..coalesce((select practicas_hora_fin from public.app_settings where id),22)-p_hours loop
    begin
     state:=public.student_schedule_preview_v2(p_student,p_enrollment,jsonb_build_object('fechaInicio',d,'modalidad',p_mode,'horasPorDia',p_hours,'horaInicio',h));
     conflict:=coalesce(conflict,state->'conflict');
     if (state->>'factible')::boolean then ok:=true;exit;end if;
    exception when sqlstate 'P7000' then
     if sqlerrm not in ('PLAN_FRANJA_PASADA','PLAN_INICIO_PASADO') then raise;end if;
    end;
   end loop;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('fecha',d,'disponible',ok,'conflict',case when not ok then conflict end,'motivo',case when not ok then conflict->>'message' end));
 end loop;
 return jsonb_build_object('serverNow',private.cohortes_now(),'dias',rows,'calendarEndDate',(select max(c.fecha_fin_curso) from public.cohorts c join public.courses cu on cu.id=c.course_id join public.enrollments e on e.course_type=cu.tipo where e.id=p_enrollment and c.habilitada and c.cancelled_at is null and c.fecha_inicio_matricula<=c.fecha_fin_matricula and c.fecha_fin_matricula<=c.fecha_fin_curso and private.cohortes_now()>=c.fecha_inicio_matricula::timestamp at time zone 'America/Guayaquil' and private.cohortes_now()<(c.fecha_fin_matricula-4)::timestamp at time zone 'America/Guayaquil'));
end $$;
create or replace function private.change_calendar_v2(p_student uuid,p_enrollment uuid,p_month date,p_mode text,p_hours integer,p_actor uuid default null,p_target uuid default null)
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare e public.enrollments;d date;h integer;plan jsonb;target uuid;t text;ok boolean;rows jsonb:='[]';slots timestamptz[];conflict jsonb;candidate_conflict jsonb;begin
 e:=private.assert_change_plan_v2(p_student,p_enrollment,p_actor,p_actor is not null);
 if p_month is null or not isfinite(p_month) or p_month<>date_trunc('month',p_month)::date or p_mode not in('entre_semana','fin_de_semana') or p_hours not between 1 and 6 then perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 for d in select generate_series(p_month,p_month+interval '1 month'-interval '1 day',interval '1 day')::date loop
  ok:=false;conflict:=null;
  if d>=(private.cohortes_now() at time zone 'America/Guayaquil')::date and((extract(isodow from d) in(6,7))=(p_mode='fin_de_semana')) then
   for h in 6..coalesce((select practicas_hora_fin from public.app_settings where id),22)-p_hours loop
    begin
     plan:=private.enrollment_plan_v2(jsonb_build_object('fechaInicio',d,'modalidad',p_mode,'horasPorDia',p_hours,'horaInicio',h));
     target:=private.change_plan_candidate_v2(e.id,jsonb_build_object('fechaInicio',d,'modalidad',p_mode,'horasPorDia',p_hours,'horaInicio',h),p_actor is not null,p_target);
     select array_agg(value::timestamptz) into slots from jsonb_array_elements_text(plan->'franjas');
     candidate_conflict:=private.own_schedule_conflict_v12(p_student,slots,e.id);conflict:=coalesce(conflict,candidate_conflict);
     ok:=target is not null and candidate_conflict is null;
     for t in select value from jsonb_array_elements_text(plan->'franjas') loop
      if not exists(select 1 from private.change_free_instructors_v2(t::timestamptz,e.id)) then ok:=false;exit;end if;
     end loop;
     if ok then exit;end if;
    exception when sqlstate 'P7000' then
     if sqlerrm not in('RESERVA_SIN_HORARIOS','PLAN_FRANJA_PASADA','PLAN_INICIO_PASADO','PLAN_OPCION_NO_OFERTADA') then raise;end if;ok:=false;
    end;
   end loop;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('fecha',d,'disponible',ok,'conflict',case when not ok then conflict end,'motivo',case when not ok then conflict->>'message' end));
 end loop;
 return jsonb_build_object('serverNow',private.cohortes_now(),'dias',rows);
end $$;
create or replace function private.eligible_free_slots_for_enrollment(
  p_enrollment_id uuid, p_excluded_slot_id uuid default null
) returns setof public.practice_slots
language plpgsql stable security invoker set search_path = '' as $$
declare e public.enrollments; v_end date; v_end_text text; v_mode text; v_now timestamptz := clock_timestamp();
begin
  select * into e from public.enrollments where id = p_enrollment_id;
  if not found then raise exception 'Matrícula no encontrada' using errcode = 'CD404'; end if;
  v_end_text := e.practice_plan->>'fechaFinElegida';
  v_mode := e.practice_plan->>'modalidad';
  if v_end_text is null or v_end_text !~ '^\d{4}-\d{2}-\d{2}$'
    or v_mode is null or v_mode not in ('entre_semana', 'fin_de_semana') then
    raise exception 'La matrícula no tiene fecha fin o modalidad de prácticas válida; requiere revisión'
      using errcode = 'CD409';
  end if;
  begin
    v_end := v_end_text::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'La fecha fin de prácticas de la matrícula es inválida; requiere revisión'
      using errcode = 'CD409';
  end;
  return query
    select s.* from public.practice_slots s
    join public.users instructor on instructor.id = s.instructor_id and instructor.activo
    join public.users student on student.id = e.student_id and student.activo
    where e.status = 'activo' and s.cohort_id = e.cohort_id
      and s.id is distinct from p_excluded_slot_id
      and not exists (
        select 1 from public.practice_slot_cancellations c
        where c.student_id = e.student_id and c.slot_id = s.id
      )
      and s.status in ('disponible', 'liberado') and s.student_id is null
      and s.duration_minutes = 60
      and s.scheduled_at > v_now
      -- Coincide con el límite vigente de reclamación: no ofrecer alternativas cerradas a T-5.
      and public.practice_slot_window_open(s.scheduled_at, v_now)
      and (s.scheduled_at at time zone 'America/Guayaquil')::date <= v_end
      and ((v_mode = 'entre_semana' and extract(isodow from s.scheduled_at at time zone 'America/Guayaquil') between 1 and 5)
        or (v_mode = 'fin_de_semana' and extract(isodow from s.scheduled_at at time zone 'America/Guayaquil') in (6, 7)))
      and (private.enrollment_rule_enabled('reservations') or not exists (
        select 1 from public.practice_slots own
        where own.student_id = e.student_id and own.id is distinct from p_excluded_slot_id
          and own.status in ('asignado', 'confirmado', 'completado')
          and tsrange(own.scheduled_at at time zone 'UTC',
            (own.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
          && tsrange(s.scheduled_at at time zone 'UTC',
            (s.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
      ))
    order by s.scheduled_at, s.id;
end;
$$;
do $released$ declare definition text;begin
 definition:=pg_get_functiondef('public.released_practice_slots_for_student(uuid)'::regprocedure);
 definition:=replace(definition,'return v_result;', $body$
 if private.enrollment_rule_enabled('reservations') then
 select coalesce(jsonb_agg(item||jsonb_build_object('conflict',case when item->>'caso'='B' then
 (select case when count(*) filter(where candidate_conflict is null)>0 then null else (jsonb_agg(candidate_conflict))->0 end from (
 select private.own_schedule_conflict_v12(p_student_id,array[(item->>'scheduledAt')::timestamptz],null,null,source_id::uuid) candidate_conflict
 from jsonb_array_elements_text(item->'practicasASoltarIds') source_id) candidates)
 else private.own_schedule_conflict_v12(p_student_id,array[(item->>'scheduledAt')::timestamptz]) end) order by item->>'scheduledAt',item->>'id'),'[]'::jsonb) into v_result from jsonb_array_elements(v_result) item;
 end if;
 return v_result;$body$);execute definition;
end $released$;
-- Un solape invalida también el resumen por día que consume la interfaz.
create or replace function public.student_schedule_preview_v2(p_student uuid,p_enrollment uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare result jsonb;plan jsonb;slots timestamptz[];conflict jsonb;failed jsonb;begin
 result:=public.base081_schedule_preview(p_student,p_enrollment,p_input);plan:=private.enrollment_plan_v2(p_input);
 select array_agg(value::timestamptz) into slots from jsonb_array_elements_text(plan->'franjas');conflict:=private.own_schedule_conflict_v12(p_student,slots);
 if conflict is not null then
 select coalesce(jsonb_agg(distinct failed_day),'[]'::jsonb) into failed from (
 select value #>> '{}' as failed_day from jsonb_array_elements(coalesce(result->'diasFallan','[]'::jsonb))
 union select to_char(t at time zone 'America/Guayaquil','YYYY-MM-DD') from unnest(slots) t where private.own_schedule_conflict_v12(p_student,array[t]) is not null) days;
 result:=result||jsonb_build_object('factible',false,'conflict',conflict,'diasFallan',failed);end if;return result;end $$;
commit;
