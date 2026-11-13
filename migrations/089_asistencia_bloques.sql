-- C14. Aplicación manual; sin activar indicadores.
begin;
set local lock_timeout='5s';
-- GUARDA-C14-NUEVAS INICIO
do $guard$ begin if to_regprocedure('private.practice_block_options_v14(uuid,date)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_options_v14(uuid,date)')) is distinct from '3e71e918864f829d3fc95aabfafac86a' then raise exception 'GUARDA_089: función C14 alterada: private.practice_block_options_v14(uuid,date)';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.practice_block_v14(uuid,uuid,date)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_v14(uuid,uuid,date)')) is distinct from '6b48e665db82f1d16a1501d8e58b8c85' then raise exception 'GUARDA_089: función C14 alterada: private.practice_block_v14(uuid,uuid,date)';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.practice_block_effect_v14(text,integer)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_effect_v14(text,integer)')) is distinct from 'fcde7be22e2a24292069ddd384dcf8c6' then raise exception 'GUARDA_089: función C14 alterada: private.practice_block_effect_v14(text,integer)';end if;end $guard$;
do $guard$ begin if to_regprocedure('preview_practice_block_cancellation_v14(uuid,uuid,date)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('preview_practice_block_cancellation_v14(uuid,uuid,date)')) is distinct from 'ed2f39e37495cb1d08a6ebea53cb7216' then raise exception 'GUARDA_089: función C14 alterada: preview_practice_block_cancellation_v14(uuid,uuid,date)';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.notify_released_block_v14(uuid)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.notify_released_block_v14(uuid)')) is distinct from '2c0d07aaeea4d36bac4f5bdb37a41849' then raise exception 'GUARDA_089: función C14 alterada: private.notify_released_block_v14(uuid)';end if;end $guard$;
do $guard$ begin if to_regprocedure('cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)')) is distinct from '66e5c7cf21f698bd96ee088b796eac3c' then raise exception 'GUARDA_089: función C14 alterada: cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)';end if;end $guard$;
do $guard$ begin if to_regprocedure('confirm_practice_block_v14(uuid,uuid,date)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('confirm_practice_block_v14(uuid,uuid,date)')) is distinct from '4c21eec9ce2e052b9391e107ed27be6f' then raise exception 'GUARDA_089: función C14 alterada: confirm_practice_block_v14(uuid,uuid,date)';end if;end $guard$;
-- GUARDA-C14-NUEVAS FIN
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_replacement_balance(uuid)')) is distinct from 'abd969f79a911133bdce49e98b265dd7' then raise exception 'GUARDA_089: private.practice_replacement_balance(uuid) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.free_instructors_v2(timestamp with time zone[],uuid,uuid)')) is distinct from '231b1953a2b029dcf350147fa2d92b02' then raise exception 'GUARDA_089: private.free_instructors_v2(timestamp with time zone[],uuid,uuid) no coincide con la instalación esperada';end if;end $guard$;
alter table public.practice_slot_cancellations add column if not exists block_slot_ids uuid[],
 add column if not exists block_hours smallint,add column if not exists block_local_date date;
do $$begin if not exists(select 1 from pg_constraint where conname='practice_cancellation_block_v14') then
 alter table public.practice_slot_cancellations add constraint practice_cancellation_block_v14 check
 ((block_slot_ids is null and block_hours is null and block_local_date is null) or
 (block_hours in(1,2) and cardinality(block_slot_ids)=block_hours and block_local_date is not null));end if;end $$;
grant insert(block_slot_ids,block_hours,block_local_date) on public.practice_slot_cancellations to service_role;
grant update(status,student_id,confirmed_at,confirmation_notified_at,release_notified_at) on public.practice_slots to service_role;
grant update(reprogramaciones_usadas) on public.enrollments to service_role;

create or replace function private.practice_block_v14(p_student uuid,p_enrollment uuid,p_date date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare e public.enrollments;b record;begin
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student and status='activo';
 if not found or not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo) then
 raise exception 'No tienes una matrícula activa para este bloque' using errcode='CD403';end if;
 select array_agg(s.id order by s.scheduled_at) ids,min(s.scheduled_at) starts,max(s.scheduled_at)+interval '1 hour' ends,
 count(*)::integer hours,count(distinct s.instructor_id) instructors,(array_agg(s.instructor_id order by s.scheduled_at))[1] instructor,
 bool_and(s.status='confirmado') confirmed into b from public.practice_slots s
 where s.student_id=p_student and s.cohort_id=e.cohort_id and s.status in('asignado','confirmado')
 and (s.scheduled_at at time zone 'America/Guayaquil')::date=p_date;
 if b.hours not in(1,2) or b.instructors<>1 or b.ends-b.starts<>make_interval(hours=>b.hours) then
 raise exception 'El día no tiene un bloque completo de una o dos horas con un solo instructor; consulta con la escuela' using errcode='CD409';end if;
 return jsonb_build_object('enrollmentId',e.id,'cohortId',e.cohort_id,'date',p_date,'slotIds',b.ids,
 'startsAt',b.starts,'endsAt',b.ends,'hours',b.hours,'instructorId',b.instructor,'confirmed',b.confirmed,
 'started',b.starts<=clock_timestamp());
end $$;

-- Una sola fórmula de elegibilidad para preview, lista, toma y avisos.
-- p_cancel_date simula únicamente la ausencia del bloque que se está evaluando.
create or replace function private.practice_block_options_v14(p_enrollment uuid,p_cancel_date date default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare e public.enrollments;v_daily integer;v_mode text;v_end date;pending public.practice_slot_cancellations;
 v_result jsonb;v_cancel jsonb;begin
 select * into e from public.enrollments where id=p_enrollment and status='activo';
 if not found then return '[]';end if;
 if not exists(select 1 from public.users where id=e.student_id and rol='estudiante' and activo) then return '[]';end if;
 if coalesce(e.practice_plan->>'horasPorDia','') !~ '^[12]$' or e.practice_plan->>'modalidad' not in('entre_semana','fin_de_semana')
 or e.practice_plan->>'fechaFinElegida' is null then
 raise exception 'La matrícula no tiene un contrato de prácticas demostrable; consulta con la escuela' using errcode='CD409';end if;
 v_daily:=(e.practice_plan->>'horasPorDia')::integer;v_mode:=e.practice_plan->>'modalidad';v_end:=(e.practice_plan->>'fechaFinElegida')::date;
 if p_cancel_date is not null then v_cancel:=private.practice_block_v14(e.student_id,e.id,p_cancel_date);
 else select * into pending from public.practice_slot_cancellations c where c.enrollment_id=e.id
 and c.resultado='reprogramable' and c.origen='alumno' and c.repuesto_en is null and c.block_slot_ids is not null
 order by c.cancelled_at,c.id limit 1;end if;
 if p_cancel_date is null and pending.id is null and e.reprogramaciones_usadas>=2 then return '[]';end if;
 with own_blocks as (
 select (s.scheduled_at at time zone 'America/Guayaquil')::date source_day,min(s.scheduled_at) starts,
 max(s.scheduled_at)+interval '1 hour' ends,count(*)::integer hours,count(distinct s.instructor_id) instructors,
 (array_agg(s.instructor_id order by s.scheduled_at))[1] instructor
 from public.practice_slots s where s.student_id=e.student_id and s.cohort_id=e.cohort_id and s.status in('asignado','confirmado')
 group by 1 having count(*) in(1,2) and count(distinct s.instructor_id)=1
 and max(s.scheduled_at)-min(s.scheduled_at)=make_interval(hours=>count(*)::integer-1)
 ), sources as (
 select source_day,starts,instructor,hours,null::uuid pending_id,1 cost from own_blocks where starts>clock_timestamp()
 and pending.id is null and p_cancel_date is null
 union all select null::date,pending.slot_starts_at,pending.instructor_id,pending.block_hours::integer,pending.id,0
 where pending.id is not null and p_cancel_date is null
 union all select p_cancel_date,(v_cancel->>'startsAt')::timestamptz,(v_cancel->>'instructorId')::uuid,(v_cancel->>'hours')::integer,null::uuid,0 where p_cancel_date is not null
 ), released as (
 select distinct c.instructor_id instructor,c.slot_starts_at starts,c.block_hours::integer hours
 from public.practice_slot_cancellations c where c.cohort_id=e.cohort_id and c.block_slot_ids is not null
 and not exists(select 1 from unnest(c.block_slot_ids) x left join public.practice_slots s on s.id=x
 where s.id is null or s.student_id is not null or s.status not in('liberado','disponible') or s.instructor_id<>c.instructor_id)
 ), times as (
 select (d.source_day::date::timestamp+make_interval(hours=>h.hour)) at time zone 'America/Guayaquil' starts
 from generate_series((clock_timestamp() at time zone 'America/Guayaquil')::date::timestamp,v_end::timestamp,interval '1 day') d(source_day)
 cross join generate_series(6,coalesce((select practicas_hora_fin from public.app_settings where id),22)-v_daily) h(hour)
 where (v_mode='entre_semana' and extract(isodow from d.source_day) between 1 and 5) or(v_mode='fin_de_semana' and extract(isodow from d.source_day) in(6,7))
 ), candidates as (
 select src.*,t.starts target_start,i.id target_instructor,i.nombre_completo instructor_name,
 exists(select 1 from released r where r.instructor=i.id and r.starts=t.starts and r.hours=src.hours) is_released
 from sources src cross join times t cross join lateral private.free_instructors_v2(
 array(select t.starts+make_interval(hours=>k) from generate_series(0,src.hours-1) k),e.student_id,null) i
 where src.hours=v_daily and t.starts>clock_timestamp()+interval '5 minutes'
 and not(t.starts=src.starts) -- El mismo horario tampoco permite cambiar solo de instructor (S1).
 and not exists(select 1 from public.practice_slot_cancellations c where c.student_id=e.student_id and c.block_slot_ids is not null and c.slot_starts_at=t.starts)
 and not exists(select 1 from public.practice_slots s where s.student_id=e.student_id and s.status in('asignado','confirmado','completado')
 and (s.scheduled_at at time zone 'America/Guayaquil')::date=(t.starts at time zone 'America/Guayaquil')::date
 and (s.scheduled_at at time zone 'America/Guayaquil')::date is distinct from coalesce(p_cancel_date,src.source_day))
 and not exists(select 1 from public.practice_slots s where s.student_id=e.student_id and s.status in('asignado','confirmado','completado')
 and (p_cancel_date is null or (s.scheduled_at at time zone 'America/Guayaquil')::date<>p_cancel_date)
 and s.scheduled_at<t.starts+make_interval(hours=>src.hours) and s.scheduled_at+interval '1 hour'>t.starts)
 ), filtered as (
 select c.* from candidates c where c.is_released or c.target_instructor=c.instructor
 or not exists(select 1 from candidates own where own.starts=c.starts and own.instructor=c.instructor and not own.is_released and own.target_instructor=own.instructor)
 )
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',md5(e.id::text||target_instructor::text||extract(epoch from target_start)::text||coalesce(source_day::text,'pendiente')||coalesce(pending_id::text,'')),
 'enrollmentId',e.id,'cohortId',e.cohort_id,'startsAt',target_start,'endsAt',target_start+make_interval(hours=>hours),
 'hours',hours,'instructorId',target_instructor,'instructorName',instructor_name,
 'kind',case when is_released then 'released' when target_instructor=instructor then 'instructor_free' else 'other_free' end,
 'sourceDate',source_day,'sourceStartsAt',case when cost=1 then starts else null end,'pendingId',pending_id,
 'cost',cost,'remaining',2-e.reprogramaciones_usadas-cost)
 order by case when is_released then 0 when target_instructor=instructor then 1 else 2 end,target_start,target_instructor,source_day),'[]') into v_result from filtered;
 return v_result;
end $$;

create or replace function private.practice_block_effect_v14(p_result text,p_used integer) returns text
language sql immutable security invoker set search_path='' as $$select case p_result
 when 'falta' then 'Registramos tu aviso como falta. Ya usaste tus 2 reprogramaciones y esta hora no se repone automáticamente. Habla con la escuela o con tu instructor en tu siguiente práctica para recuperarla.'
 when 'hora_perdida' then 'No hay horarios libres para reponer este bloque antes de tu fecha fin. El bloque se pierde y no consume una reprogramación.'
 else 'Este aviso usará 1 de tus 2 reprogramaciones; te quedarán '||(1-p_used)::text||'. Elige un nuevo horario en Horarios de práctica.' end $$;

create or replace function public.preview_practice_block_cancellation_v14(p_student uuid,p_enrollment uuid,p_date date)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$declare b jsonb;e public.enrollments;r text;begin
 b:=private.practice_block_v14(p_student,p_enrollment,p_date);select * into e from public.enrollments where id=p_enrollment;
 r:=case when e.reprogramaciones_usadas>=2 then 'falta' when jsonb_array_length(private.practice_block_options_v14(e.id,p_date))>0 then 'reprogramable' else 'hora_perdida' end;
 return jsonb_build_object('block',b,'result',r,'used',e.reprogramaciones_usadas,'remaining',2-e.reprogramaciones_usadas,
 'started',(b->>'started')::boolean,'effect',case when (b->>'started')::boolean then 'Este bloque ya comenzó y no se puede cancelar desde la plataforma.' else private.practice_block_effect_v14(r,e.reprogramaciones_usadas) end);
end $$;

create or replace function private.notify_released_block_v14(p_slot uuid) returns void
language plpgsql security invoker set search_path='' as $$declare s public.practice_slots;e record;begin
 select * into s from public.practice_slots where id=p_slot;
 if not public.practice_slot_window_open(s.scheduled_at,clock_timestamp()) then return;end if;
 for e in select id,student_id from public.enrollments where cohort_id=s.cohort_id and status='activo' loop
 begin
 if exists(select 1 from jsonb_array_elements(private.practice_block_options_v14(e.id)) o
 where o->>'kind'='released' and (o->>'startsAt')::timestamptz=s.scheduled_at and (o->>'instructorId')::uuid=s.instructor_id) then
 perform private.enqueue_practice_notification(e.student_id,'cupo_disponible','Hay un cupo disponible',
 'Hay un bloque disponible para ti. Abre Cupos disponibles en Horarios de práctica.',s.id,s.scheduled_at,false);end if;
 exception when sqlstate 'CD409' then null;end;
 end loop;
end $$;

create or replace function public.cancel_practice_block_with_reason_v14(p_student uuid,p_enrollment uuid,p_date date,p_category text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.enrollments;b jsonb;v_preview jsonb;v_ids uuid[];v_result text;v_number smallint;v_id uuid;v_late boolean;begin
 if p_category is null or p_category not in('salud','trabajo','estudios','familiar','transporte','otro') or p_reason is null or length(btrim(p_reason))<10 then
 raise exception 'Indica una categoría válida y un motivo de al menos 10 caracteres' using errcode='22023';end if;
 perform private.lock_student_schedule_v12(p_student);perform private.assert_student_not_deleting(p_student);
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student for update;
 perform 1 from public.cohorts where id=e.cohort_id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 b:=private.practice_block_v14(p_student,p_enrollment,p_date);
 select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(b->'slotIds');
 perform 1 from public.practice_slots where id=any(v_ids) order by id for update;
 v_preview:=public.preview_practice_block_cancellation_v14(p_student,p_enrollment,p_date);
 if (b->>'startsAt')::timestamptz<=clock_timestamp() then raise exception 'Este bloque ya comenzó y no se puede cancelar desde la plataforma' using errcode='CD409';end if;
 v_result:=v_preview->>'result';v_late:=not public.practice_slot_window_open((b->>'startsAt')::timestamptz,clock_timestamp());
 if v_result='reprogramable' then update public.enrollments set reprogramaciones_usadas=reprogramaciones_usadas+1 where id=e.id and reprogramaciones_usadas<2 returning reprogramaciones_usadas into v_number;
 if not found then raise exception 'El contador cambió; vuelve a consultar' using errcode='CD409';end if;end if;
 insert into public.practice_slot_cancellations(slot_id,enrollment_id,student_id,instructor_id,cohort_id,slot_starts_at,cancelled_at,
 motivo_categoria,motivo_texto,resultado,consumio_reprogramacion,reprogramacion_numero,block_slot_ids,block_hours,block_local_date)
 values(v_ids[1],e.id,p_student,(b->>'instructorId')::uuid,e.cohort_id,(b->>'startsAt')::timestamptz,clock_timestamp(),p_category,btrim(p_reason),v_result,v_result='reprogramable',v_number,v_ids,(b->>'hours')::integer,p_date) returning id into v_id;
 update public.practice_slots set student_id=null,status=case when v_late then 'sin_practica'::public.practice_slot_status else 'liberado'::public.practice_slot_status end,
 confirmed_at=null,confirmation_notified_at=null,release_notified_at=null where id=any(v_ids);
 perform private.enqueue_practice_notification(p_student,'resultado_cancelacion','Aviso de inasistencia registrado',private.practice_block_effect_v14(v_result,e.reprogramaciones_usadas),v_ids[1],(b->>'startsAt')::timestamptz,false);
 if v_late then perform private.enqueue_practice_notification((b->>'instructorId')::uuid,'sin_practica_instructor','No habrá práctica en este bloque','El alumno avisó que no asistirá al bloque.',v_ids[1],(b->>'startsAt')::timestamptz,true);
 else perform private.notify_released_block_v14(v_ids[1]);end if;
 return jsonb_build_object('block',b,'cancellationId',v_id,'result',v_result,'used',coalesce(v_number,e.reprogramaciones_usadas),'remaining',2-coalesce(v_number,e.reprogramaciones_usadas),'effect',private.practice_block_effect_v14(v_result,e.reprogramaciones_usadas));
end $$;

create or replace function public.confirm_practice_block_v14(p_student uuid,p_enrollment uuid,p_date date)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$declare b jsonb;ids uuid[];begin
 perform private.lock_student_schedule_v12(p_student);perform private.assert_student_not_deleting(p_student);
 b:=private.practice_block_v14(p_student,p_enrollment,p_date);
 if (b->>'startsAt')::timestamptz<=clock_timestamp() then raise exception 'Este bloque ya comenzó' using errcode='CD409';end if;
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(b->'slotIds');
 perform 1 from public.practice_slots where id=any(ids) order by id for update;
 update public.practice_slots set status='confirmado',confirmed_at=clock_timestamp() where id=any(ids) and student_id=p_student and status in('asignado','confirmado');
 return b||jsonb_build_object('confirmed',true);
end $$;

-- Todas las funciones C14 son exclusivas del backend, incluidas las llamadas por disparadores.
do $acl$ declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in ('practice_block_v14','practice_block_options_v14','practice_block_effect_v14','preview_practice_block_cancellation_v14','notify_released_block_v14','cancel_practice_block_with_reason_v14','confirm_practice_block_v14') loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end $acl$;
notify pgrst, 'reload schema';
commit;
