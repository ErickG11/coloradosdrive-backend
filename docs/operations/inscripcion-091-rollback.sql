begin;
set local lock_timeout='5s';
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('student_practice_history(uuid,uuid,integer,integer)')) is distinct from '539beba6c7bcf5e149e07b40398eb1e6' then raise exception 'ROLLBACK_091: cuerpo desconocido: student_practice_history(uuid,uuid,integer,integer)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('instructor_practice_blocks_v14(uuid,date,date)')) is distinct from '33b9d31cf269f339877543a393027864' then raise exception 'ROLLBACK_091: cuerpo desconocido: instructor_practice_blocks_v14(uuid,date,date)';end if;end $guard$;
-- Rollback condicionado a los cuerpos instalados; nunca sobreescribir cambios ajenos.
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_options_v14(uuid,date)')) is distinct from 'e24733e12a84c42895388f359b2cb311' then raise exception 'ROLLBACK_091: cuerpo desconocido: private.practice_block_options_v14(uuid,date)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_v14(uuid,uuid,date)')) is distinct from '884fb434efa35e480627daa4d92f1814' then raise exception 'ROLLBACK_091: cuerpo desconocido: private.practice_block_v14(uuid,uuid,date)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.notify_released_block_v14(uuid)')) is distinct from '1ece6f5e6cd66087ea65e8b29f826fbb' then raise exception 'ROLLBACK_091: cuerpo desconocido: private.notify_released_block_v14(uuid)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)')) is distinct from 'a3a4703ac5b5c908ef392fed708d1be8' then raise exception 'ROLLBACK_091: cuerpo desconocido: cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_result_message_v14(jsonb,text,integer)')) is distinct from '56683e3692d18da51511cc4019c65c4b' then raise exception 'ROLLBACK_091: cuerpo desconocido: private.practice_block_result_message_v14(jsonb,text,integer)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_instructor_notice_v14(uuid,uuid,text)')) is distinct from '318b205fca48cd7b7707779dbe95e1e9' then raise exception 'ROLLBACK_091: cuerpo desconocido: private.practice_block_instructor_notice_v14(uuid,uuid,text)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_absence_notice_v14(uuid,uuid,jsonb)')) is distinct from '47c6819d802f7333e64819b6858989da' then raise exception 'ROLLBACK_091: cuerpo desconocido: private.practice_block_absence_notice_v14(uuid,uuid,jsonb)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('admin_practice_absences_v14(uuid,uuid)')) is distinct from '7d126722c847189276f03d2ed7ee5c4e' then raise exception 'ROLLBACK_091: cuerpo desconocido: admin_practice_absences_v14(uuid,uuid)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('take_practice_block_v14(uuid,uuid,text)')) is distinct from '8cb5513f1f4f47c5c12eb97973f1c6af' then raise exception 'ROLLBACK_091: cuerpo desconocido: take_practice_block_v14(uuid,uuid,text)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.base_scheduler_transition_v14(uuid,text,text)')) is distinct from 'e9a05c800b9daf2081be77f9c6b3691f' then raise exception 'ROLLBACK_091: cuerpo desconocido: private.base_scheduler_transition_v14(uuid,text,text)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('transition_practice_slot_for_scheduler(uuid,text,text)')) is distinct from 'd5cbecbfc7f35a57691cc29a207e7b55' then raise exception 'ROLLBACK_091: cuerpo desconocido: transition_practice_slot_for_scheduler(uuid,text,text)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('confirm_practice_block_v14(uuid,uuid,date)')) is distinct from '36c45e621e8c5a7b121b095b9dbd13bd' then raise exception 'ROLLBACK_091: cuerpo desconocido: confirm_practice_block_v14(uuid,uuid,date)';end if;end $guard$;
do $$begin if exists(select 1 from public.notifications where tipo in('cambio_agenda_instructor','falta_registrada_admin') or block_offer_group is not null) then raise exception 'ROLLBACK_091: existen avisos por bloque; revisar y conservar la auditoría antes de revertir';end if;end $$;
CREATE OR REPLACE FUNCTION private.notify_released_block_v14(p_slot uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare s public.practice_slots;e record;begin
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
end $function$
;
CREATE OR REPLACE FUNCTION public.cancel_practice_block_with_reason_v14(p_student uuid, p_enrollment uuid, p_date date, p_category text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.take_practice_block_v14(p_student uuid, p_enrollment uuid, p_option text)
 RETURNS jsonb
 LANGUAGE plpgsql
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
 if v_starts<=clock_timestamp()+interval '5 minutes' then raise exception 'Faltan 5 minutos o menos: el cupo ya cerró' using errcode='CD409';end if;
 if (o->>'cost')::integer=1 then
 insert into public.practice_slot_cancellations(slot_id,enrollment_id,student_id,instructor_id,cohort_id,slot_starts_at,cancelled_at,motivo_categoria,motivo_texto,resultado,consumio_reprogramacion,reprogramacion_numero,origen,repuesto_por_slot_id,repuesto_en,block_slot_ids,block_hours,block_local_date)
 values(source_ids[1],e.id,p_student,(source->>'instructorId')::uuid,e.cohort_id,(source->>'startsAt')::timestamptz,clock_timestamp(),'otro','Cambio del bloque por otro horario disponible','reprogramable',true,v_number,'cambio_cupo',target_ids[1],clock_timestamp(),source_ids,v_hours,(source->>'date')::date) returning id into v_cancel;
 perform private.notify_released_block_v14(source_ids[1]);
 else
 update public.practice_slot_cancellations set repuesto_por_slot_id=target_ids[1],repuesto_en=clock_timestamp()
 where id=(o->>'pendingId')::uuid and enrollment_id=e.id and repuesto_en is null returning id into v_cancel;
 if not found then raise exception 'La reposición ya fue utilizada; vuelve a consultar' using errcode='CD409';end if;
 end if;
 perform private.enqueue_practice_notification(p_student,'cambio_realizado','Horario actualizado',case when (o->>'cost')::integer=0 then 'Repusiste el bloque pendiente sin consumir otra reprogramación.' else 'Cambiaste el bloque completo y usaste una reprogramación.' end,target_ids[1],v_starts,false);
 return jsonb_build_object('option',o,'slotIds',target_ids,'source',source,'used',coalesce(v_number,e.reprogramaciones_usadas),'remaining',2-coalesce(v_number,e.reprogramaciones_usadas),'cancellationId',v_cancel);
end $function$
;
CREATE OR REPLACE FUNCTION public.transition_practice_slot_for_scheduler(p_slot_id uuid, p_transition text, p_expected_version text)
 RETURNS SETOF practice_slots
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_slot public.practice_slots; current_version text;
begin
  select s.* into current_slot from public.practice_slots s where s.id = p_slot_id for update;
  if not found then return; end if;
  select s.xmin::text into current_version from public.practice_slots s where s.id = p_slot_id;
  if current_version is distinct from p_expected_version then return; end if;
  if p_transition = 'remind' then
    return query update public.practice_slots s set confirmation_notified_at = clock_timestamp()
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status in ('asignado', 'confirmado') and s.student_id = current_slot.student_id
      and s.confirmation_notified_at is null
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
    if found and current_slot.student_id is not null then
      perform private.enqueue_practice_notification(current_slot.student_id, 'recordatorio_practica', 'Tu práctica comienza pronto',
        'Confirmar es opcional. Si no respondes, tu práctica se mantiene programada.',
        current_slot.id, current_slot.scheduled_at, true);
    end if;
  elsif p_transition = 'close' then
    return query update public.practice_slots s set status = 'sin_practica', student_id = null,
      confirmed_at = null, confirmation_notified_at = null
    where s.id = p_slot_id and s.xmin::text = p_expected_version and s.status = 'liberado'
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
    if found then
      perform private.enqueue_practice_notification(current_slot.instructor_id, 'sin_practica_instructor', 'No habrá práctica en este bloque',
        'El cupo liberado sigue vacío y este bloque queda sin práctica.',
        current_slot.id, current_slot.scheduled_at, true);
    end if;
  elsif p_transition = 'complete' then
    return query update public.practice_slots s set status = 'completado'
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status in ('asignado', 'confirmado') and s.student_id = current_slot.student_id
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  end if;
end;
$function$
;
drop function private.base_scheduler_transition_v14(uuid,text,text);
drop function public.admin_practice_absences_v14(uuid,uuid);
drop function private.practice_block_absence_notice_v14(uuid,uuid,jsonb);
drop function private.practice_block_instructor_notice_v14(uuid,uuid,text);
drop function private.practice_block_result_message_v14(jsonb,text,integer);
alter table public.notifications drop column block_offer_group;
alter table public.notifications drop constraint notifications_blocks_inbox_only_v14;
alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check CHECK (((tipo = ANY (ARRAY['recordatorio_practica'::text, 'resultado_cancelacion'::text, 'cupo_disponible'::text, 'sin_practica_instructor'::text, 'cambio_realizado'::text, 'asistencia_corregida'::text, 'encuesta_practica'::text, 'documento_aprobado'::text, 'documento_rechazado'::text, 'contenido_habilitado'::text, 'examen_habilitado'::text, 'intento_extra'::text])) OR (tipo = 'espera_apertura'::text) OR (tipo = 'plan_cambiado'::text)));

CREATE OR REPLACE FUNCTION private.practice_block_v14(p_student uuid, p_enrollment uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION private.practice_block_options_v14(p_enrollment uuid, p_cancel_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
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
end $function$
;
CREATE OR REPLACE FUNCTION public.confirm_practice_block_v14(p_student uuid, p_enrollment uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$declare b jsonb;ids uuid[];begin
 perform private.lock_student_schedule_v12(p_student);perform private.assert_student_not_deleting(p_student);
 b:=private.practice_block_v14(p_student,p_enrollment,p_date);
 if (b->>'startsAt')::timestamptz<=clock_timestamp() then raise exception 'Este bloque ya comenzó' using errcode='CD409';end if;
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(b->'slotIds');
 perform 1 from public.practice_slots where id=any(ids) order by id for update;
 update public.practice_slots set status='confirmado',confirmed_at=clock_timestamp() where id=any(ids) and student_id=p_student and status in('asignado','confirmado');
 return b||jsonb_build_object('confirmed',true);
end $function$
;
drop policy if exists notifications_broadcast_v14 on realtime.messages;
drop function public.instructor_practice_blocks_v14(uuid,date,date);
CREATE OR REPLACE FUNCTION public.student_practice_history(p_student uuid, p_enrollment uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare e public.enrollments; v_result jsonb;
begin if private.enrollment_rule_enabled('reservations') then perform private.lock_student_schedule_v12(p_student);end if;
  if not exists(select 1 from public.users where id = p_student and activo and rol = 'estudiante') then
    raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'AT403'; end if;
  select * into e from public.enrollments where id = p_enrollment and student_id = p_student;
  if not found then raise exception 'Matrícula no encontrada' using errcode = 'CD404'; end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Paginación inválida' using errcode = '22023'; end if;
  -- practice_slots no tiene enrollment_id. No duplicar horas si existen
  -- varias matriculas historicas del mismo alumno en una misma cohorte.
  if e.cohort_id is not null and exists(select 1 from public.enrollments other
    where other.student_id = p_student and other.cohort_id = e.cohort_id and other.id <> e.id) then
    raise exception 'Hay varias matrículas en la misma cohorte; el historial requiere revisión administrativa' using errcode = 'CD409'; end if;
  with practices as (
    select 'practice:' || s.id::text as id, s.id as slot_id, null::uuid as cancellation_id,
      s.scheduled_at, s.duration_minutes, s.status::text as slot_status, s.attended,
      case when s.status = 'completado' and s.attended then 'asistio'
        when s.status = 'completado' and s.attended = false then 'no_asistio' else 'pendiente' end as estado,
      null::text as resultado, null::text as motivo,
      case when s.status = 'completado' and s.attended then s.duration_minutes else 0 end as attended_minutes,
      case when s.status = 'completado' and s.attended = false then s.duration_minutes else 0 end as lost_minutes
    from public.practice_slots s where s.student_id = p_student and s.cohort_id = e.cohort_id
    union all
    select 'cancellation:' || c.id::text, c.slot_id, c.id, c.slot_starts_at, 60, null::text, null::boolean,
      case when c.resultado = 'falta' then 'falta'
        when c.resultado = 'reprogramable' and c.repuesto_en is null then 'liberada' else 'cancelada' end,
      c.resultado, c.motivo_texto, 0, case when c.resultado in ('hora_perdida', 'falta') then 60 else 0 end
    from public.practice_slot_cancellations c where c.enrollment_id = e.id and c.student_id = p_student
    union all
    select 'recovery:' || r.slot_id::text, r.slot_id, null::uuid, r.scheduled_at, null::integer,
      null::text, null::boolean, 'liberada', null::text, r.reason, 0, 0
    from public.student_practice_recovery r where r.student_id = p_student and r.cohort_id = e.cohort_id
      and r.status in ('cancelada_por_desactivacion', 'pendiente_reprogramar')
      and not exists(select 1 from public.practice_slots s where s.id = r.slot_id and s.student_id = p_student
        and s.cohort_id = r.cohort_id and s.scheduled_at = r.scheduled_at and s.instructor_id = r.instructor_id)
      and not exists(select 1 from public.practice_slot_cancellations c where c.student_id = p_student
        and c.enrollment_id = e.id and c.slot_id = r.slot_id and c.slot_starts_at = r.scheduled_at)
  ), items as (
    select * from practices order by scheduled_at desc, id desc limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object('items', (select coalesce(jsonb_agg(to_jsonb(i) - 'attended_minutes' - 'lost_minutes'
      order by i.scheduled_at desc, i.id desc), '[]'::jsonb) from items i),
    'total', count(*), 'summary', jsonb_build_object(
      'horasAsistidas', round(coalesce(sum(attended_minutes), 0) / 60.0, 2),
      'horasObjetivo', e.horas_practica_objetivo,
      'horasPerdidas', round(coalesce(sum(lost_minutes), 0) / 60.0, 2))) into v_result from practices;
  return v_result;
end;
$function$
;
notify pgrst, 'reload schema';
commit;
