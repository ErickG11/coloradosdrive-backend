begin;
set local lock_timeout='5s';
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.practice_block_options_v14(uuid,date)');if h is distinct from 'c1a5007099b04d0d4be142502f181396' then raise exception 'ROLLBACK_092: cuerpo desconocido: private.practice_block_options_v14(uuid,date)';end if;end $guard$;
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('take_practice_block_v14(uuid,uuid,text)');if h is distinct from '7f7fab465f4d7c629b85465780a639a3' then raise exception 'ROLLBACK_092: cuerpo desconocido: take_practice_block_v14(uuid,uuid,text)';end if;end $guard$;
do $$begin if exists(select 1 from public.practice_slot_cancellations where accion is not null) then raise exception 'ROLLBACK_092: existen avisos de un paso en la auditoría; conservar antes de revertir';end if;end $$;
CREATE OR REPLACE FUNCTION private.practice_block_options_v14(p_enrollment uuid, p_cancel_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
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
 select source_day,starts,instructor,hours,null::uuid pending_id,1 cost from own_blocks where starts>private.cohortes_now()
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
 from generate_series((private.cohortes_now() at time zone 'America/Guayaquil')::date::timestamp,v_end::timestamp,interval '1 day') d(source_day)
 cross join generate_series(6,coalesce((select practicas_hora_fin from public.app_settings where id),22)-1) h(hour)
 where (v_mode='entre_semana' and extract(isodow from d.source_day) between 1 and 5) or(v_mode='fin_de_semana' and extract(isodow from d.source_day) in(6,7))
 ), candidates as (
 select src.*,t.starts target_start,i.id target_instructor,i.nombre_completo instructor_name,
 exists(select 1 from released r where r.instructor=i.id and r.starts=t.starts and r.hours=src.hours) is_released
 from sources src cross join times t cross join lateral private.free_instructors_v2(
 array(select t.starts+make_interval(hours=>k) from generate_series(0,src.hours-1) k),e.student_id,null) i
 where src.hours in(1,2) and extract(hour from t.starts at time zone 'America/Guayaquil')+src.hours<=coalesce((select practicas_hora_fin from public.app_settings where id),22) and t.starts>private.cohortes_now()+interval '5 minutes'
 and not(t.starts=src.starts) -- El mismo horario tampoco permite cambiar solo de instructor (S1).
 and not exists(select 1 from public.practice_slot_cancellations c where c.student_id=e.student_id and c.block_slot_ids is not null and c.slot_starts_at=t.starts)
 and not exists(select 1 from public.practice_slots s where s.student_id=e.student_id and s.cohort_id=e.cohort_id and s.status in('asignado','confirmado','completado')
 and (s.scheduled_at at time zone 'America/Guayaquil')::date=(t.starts at time zone 'America/Guayaquil')::date
 and (s.scheduled_at at time zone 'America/Guayaquil')::date is distinct from coalesce(p_cancel_date,src.source_day))
 and not exists(select 1 from public.practice_slots s where s.student_id=e.student_id and s.status in('asignado','confirmado','completado')
 and (p_cancel_date is null or s.cohort_id<>e.cohort_id or (s.scheduled_at at time zone 'America/Guayaquil')::date<>p_cancel_date)
 and s.scheduled_at<t.starts+make_interval(hours=>src.hours) and s.scheduled_at+interval '1 hour'>t.starts)
 ), filtered as (
 select c.* from candidates c where c.is_released or c.target_instructor=c.instructor
 or (c.cost=0 and not exists(select 1 from candidates own where own.starts=c.starts and own.instructor=c.instructor and own.target_instructor=own.instructor))
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
end $function$
;
CREATE OR REPLACE FUNCTION public.take_practice_block_v14(p_student uuid, p_enrollment uuid, p_option text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare e public.enrollments;o jsonb;source jsonb;source_ids uuid[];target_ids uuid[]:='{}';v_slot uuid;t timestamptz;
 v_starts timestamptz;v_instructor uuid;v_hours integer;v_number smallint;v_cancel uuid;v_late boolean;begin
 perform private.lock_student_schedule_v12(p_student);perform private.assert_student_not_deleting(p_student);
 perform 1 from public.users where id=p_student and activo and rol='estudiante' for update;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student and status='activo' for update;
 if not found then raise exception 'No tienes una matrícula activa para este bloque' using errcode='CD403';end if;
 perform 1 from public.cohorts where id=e.cohort_id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 select value into o from jsonb_array_elements(private.practice_block_options_v14(e.id)) where value->>'id'=p_option;
 if o is null then raise exception 'Otro alumno tomó este cupo o ya no está disponible. Vuelve a consultar.' using errcode='CD409';end if;
 v_starts:=(o->>'startsAt')::timestamptz;v_instructor:=(o->>'instructorId')::uuid;v_hours:=(o->>'hours')::integer;
 if (o->>'cost')::integer=1 then
 source:=private.practice_block_v14(p_student,e.id,(o->>'sourceDate')::date);
 if (source->>'started')::boolean then raise exception 'El bloque que ibas a cambiar ya comenzó' using errcode='CD409';end if;
 select array_agg(value::uuid) into source_ids from jsonb_array_elements_text(source->'slotIds');
 end if;
 perform 1 from public.practice_slots s where s.id=any(coalesce(source_ids,'{}')) or(s.instructor_id=v_instructor and s.scheduled_at>=v_starts and s.scheduled_at<v_starts+make_interval(hours=>v_hours)) order by s.id for update;
 if (o->>'cost')::integer=1 then
 update public.practice_slots set student_id=null,status='liberado',confirmed_at=null,confirmation_notified_at=null,release_notified_at=null where id=any(source_ids);
 update public.enrollments set reprogramaciones_usadas=reprogramaciones_usadas+1 where id=e.id and reprogramaciones_usadas<2 returning reprogramaciones_usadas into v_number;
 if not found then raise exception 'Ya usaste tus 2 reprogramaciones' using errcode='CD409';end if;
 end if;
 if not exists(select 1 from private.free_instructors_v2(array(select v_starts+make_interval(hours=>k) from generate_series(0,v_hours-1) k),p_student,null) where id=v_instructor) then
 raise exception 'Otro alumno tomó este cupo o está reservado por una inscripción. Vuelve a consultar.' using errcode='CD409';end if;
 for t in select v_starts+make_interval(hours=>k) from generate_series(0,v_hours-1) k loop
 v_slot:=null;select id into v_slot from public.practice_slots where instructor_id=v_instructor and scheduled_at=t and student_id is null and status in('disponible','liberado') order by id limit 1 for update;
 if v_slot is null then insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status) values(e.cohort_id,v_instructor,p_student,t,60,'asignado') returning id into v_slot;
 else update public.practice_slots set cohort_id=e.cohort_id,student_id=p_student,status='asignado',confirmed_at=null,confirmation_notified_at=null,release_notified_at=null where id=v_slot;end if;
 target_ids:=array_append(target_ids,v_slot);
 end loop;
 if v_starts<=private.cohortes_now()+interval '5 minutes' then raise exception 'Faltan 5 minutos o menos: el cupo ya cerró' using errcode='CD409';end if;
 if (o->>'cost')::integer=1 then
 insert into public.practice_slot_cancellations(slot_id,enrollment_id,student_id,instructor_id,cohort_id,slot_starts_at,cancelled_at,motivo_categoria,motivo_texto,resultado,consumio_reprogramacion,reprogramacion_numero,origen,repuesto_por_slot_id,repuesto_en,block_slot_ids,block_hours,block_local_date)
 values(source_ids[1],e.id,p_student,(source->>'instructorId')::uuid,e.cohort_id,(source->>'startsAt')::timestamptz,private.cohortes_now(),'otro','Cambio del bloque por otro horario disponible','reprogramable',true,v_number,'cambio_cupo',target_ids[1],private.cohortes_now(),source_ids,v_hours,(source->>'date')::date) returning id into v_cancel;
 perform private.notify_released_block_v14(source_ids[1]);
 else
 update public.practice_slot_cancellations set repuesto_por_slot_id=target_ids[1],repuesto_en=private.cohortes_now()
 where id=(o->>'pendingId')::uuid and enrollment_id=e.id and repuesto_en is null returning id into v_cancel;
 if not found then raise exception 'La reposición ya fue utilizada; vuelve a consultar' using errcode='CD409';end if;
 end if;
 perform private.enqueue_practice_notification(p_student,'cambio_realizado','Horario actualizado',case when (o->>'cost')::integer=0 then 'Repusiste el bloque pendiente sin consumir otra reprogramación.' else 'Cambiaste el bloque completo y usaste una reprogramación.' end,target_ids[1],v_starts,false);
 perform private.practice_block_instructor_notice_v14(v_instructor,target_ids[1],'Cambio en tu agenda: un alumno tomó este bloque completo.');
 if source is not null then perform private.practice_block_instructor_notice_v14((source->>'instructorId')::uuid,source_ids[1],'Cambio en tu agenda: el alumno cambió este bloque y quedó libre.');end if;
 return jsonb_build_object('cohortId',e.cohort_id,'audience',(select coalesce(jsonb_agg(distinct user_id),'[]') from public.notifications where practice_slot_id=any(target_ids||coalesce(source_ids,'{}')) or block_offer_group in(select id from public.enrollments where cohort_id=e.cohort_id)),'option',o,'slotIds',target_ids,'source',source,'used',coalesce(v_number,e.reprogramaciones_usadas),'remaining',2-coalesce(v_number,e.reprogramaciones_usadas),'cancellationId',v_cancel);
end $function$
;
drop function resolve_practice_block_v17(uuid,uuid,date,text,timestamp with time zone,text,text);
drop function preview_practice_block_resolution_v17(uuid,uuid,date);
drop function private.practice_day_options_v17(uuid,date);
drop function private.practice_result_notice_v17(uuid,text,text,text,uuid,timestamp with time zone);
drop function private.practice_range_label_v17(timestamp with time zone,integer);
drop function private.practice_day_label_v17(timestamp with time zone);
alter table public.practice_slot_cancellations drop constraint practice_cancellation_accion_v17;
alter table public.practice_slot_cancellations drop column accion;
notify pgrst, 'reload schema';
commit;
