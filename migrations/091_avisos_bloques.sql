-- C14. Aplicación manual; sin activar indicadores.
begin;
set local lock_timeout='5s';
-- GUARDA-C14-NUEVAS INICIO
do $guard$ begin if to_regprocedure('private.base_scheduler_transition_v14(uuid,text,text)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.base_scheduler_transition_v14(uuid,text,text)')) is distinct from 'e9a05c800b9daf2081be77f9c6b3691f' then raise exception 'GUARDA_091: función C14 alterada: private.base_scheduler_transition_v14(uuid,text,text)';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.practice_block_result_message_v14(jsonb,text,integer)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_result_message_v14(jsonb,text,integer)')) is distinct from '56683e3692d18da51511cc4019c65c4b' then raise exception 'GUARDA_091: función C14 alterada: private.practice_block_result_message_v14(jsonb,text,integer)';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.practice_block_instructor_notice_v14(uuid,uuid,text)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_instructor_notice_v14(uuid,uuid,text)')) is distinct from '318b205fca48cd7b7707779dbe95e1e9' then raise exception 'GUARDA_091: función C14 alterada: private.practice_block_instructor_notice_v14(uuid,uuid,text)';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.practice_block_absence_notice_v14(uuid,uuid,jsonb)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_absence_notice_v14(uuid,uuid,jsonb)')) is distinct from '47c6819d802f7333e64819b6858989da' then raise exception 'GUARDA_091: función C14 alterada: private.practice_block_absence_notice_v14(uuid,uuid,jsonb)';end if;end $guard$;
do $guard$ begin if to_regprocedure('admin_practice_absences_v14(uuid,uuid)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('admin_practice_absences_v14(uuid,uuid)')) is distinct from '7d126722c847189276f03d2ed7ee5c4e' then raise exception 'GUARDA_091: función C14 alterada: admin_practice_absences_v14(uuid,uuid)';end if;end $guard$;
do $guard$ begin if to_regprocedure('instructor_practice_blocks_v14(uuid,date,date)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('instructor_practice_blocks_v14(uuid,date,date)')) is distinct from '33b9d31cf269f339877543a393027864' then raise exception 'GUARDA_091: función C14 alterada: instructor_practice_blocks_v14(uuid,date,date)';end if;end $guard$;
-- GUARDA-C14-NUEVAS FIN
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('student_practice_history(uuid,uuid,integer,integer)')) is distinct from 'f51b4183d6f4c83f10cf9988e7cbd4b2' and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('student_practice_history(uuid,uuid,integer,integer)')) is distinct from '539beba6c7bcf5e149e07b40398eb1e6' then raise exception 'GUARDA_091: student_practice_history(uuid,uuid,integer,integer) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('confirm_practice_block_v14(uuid,uuid,date)')) is distinct from '4c21eec9ce2e052b9391e107ed27be6f' and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('confirm_practice_block_v14(uuid,uuid,date)')) is distinct from '36c45e621e8c5a7b121b095b9dbd13bd' then raise exception 'GUARDA_091: confirm_practice_block_v14(uuid,uuid,date) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_options_v14(uuid,date)')) is distinct from '3e71e918864f829d3fc95aabfafac86a' and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_options_v14(uuid,date)')) is distinct from 'e24733e12a84c42895388f359b2cb311' then raise exception 'GUARDA_091: private.practice_block_options_v14(uuid,date) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_v14(uuid,uuid,date)')) is distinct from '6b48e665db82f1d16a1501d8e58b8c85' and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_block_v14(uuid,uuid,date)')) is distinct from '884fb434efa35e480627daa4d92f1814' then raise exception 'GUARDA_091: private.practice_block_v14(uuid,uuid,date) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.notify_released_block_v14(uuid)')) is distinct from '2c0d07aaeea4d36bac4f5bdb37a41849' and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.notify_released_block_v14(uuid)')) is distinct from '1ece6f5e6cd66087ea65e8b29f826fbb' then raise exception 'GUARDA_091: private.notify_released_block_v14(uuid) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)')) is distinct from '66e5c7cf21f698bd96ee088b796eac3c' and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)')) is distinct from 'a3a4703ac5b5c908ef392fed708d1be8' then raise exception 'GUARDA_091: cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('take_practice_block_v14(uuid,uuid,text)')) is distinct from 'a206d11976c334e90a31348071e8e0a0' and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('take_practice_block_v14(uuid,uuid,text)')) is distinct from '8cb5513f1f4f47c5c12eb97973f1c6af' then raise exception 'GUARDA_091: take_practice_block_v14(uuid,uuid,text) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('transition_practice_slot_for_scheduler(uuid,text,text)')) is distinct from 'e9a05c800b9daf2081be77f9c6b3691f' and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('transition_practice_slot_for_scheduler(uuid,text,text)')) is distinct from 'd5cbecbfc7f35a57691cc29a207e7b55' then raise exception 'GUARDA_091: transition_practice_slot_for_scheduler(uuid,text,text) no coincide con la instalación esperada';end if;end $guard$;
do $$declare h text;begin select md5(pg_get_constraintdef(oid)) into h from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_tipo_check';if h is distinct from '5fd97756c26548e0b84287fc153a1b33' and h is distinct from '0689b57485cb91e460b6ccfc380ed3d5' then raise exception 'GUARDA_091: restricción de tipos desconocida (%)',coalesce(h,'AUSENTE');end if;end $$;
alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check CHECK (((tipo = ANY (ARRAY['recordatorio_practica'::text, 'resultado_cancelacion'::text, 'cupo_disponible'::text, 'sin_practica_instructor'::text, 'cambio_realizado'::text, 'asistencia_corregida'::text, 'encuesta_practica'::text, 'documento_aprobado'::text, 'documento_rechazado'::text, 'contenido_habilitado'::text, 'examen_habilitado'::text, 'intento_extra'::text])) OR (tipo = 'espera_apertura'::text) OR (tipo = 'plan_cambiado'::text)) OR tipo IN ('cambio_agenda_instructor','falta_registrada_admin'));
alter table public.notifications add column if not exists block_offer_group uuid;
create unique index if not exists notifications_block_offer_v14 on public.notifications(user_id,block_offer_group)
 where tipo='cupo_disponible' and block_offer_group is not null;
grant insert(user_id,tipo,titulo,mensaje,practice_slot_id,scheduled_at,email_status,block_offer_group) on public.notifications to service_role;
grant update(titulo,mensaje,practice_slot_id,scheduled_at,created_at,read_at,block_offer_group) on public.notifications to service_role;
create or replace function private.practice_block_result_message_v14(p_block jsonb,p_result text,p_used integer)
returns text language sql immutable security invoker set search_path='' as $$select case p_result
 when 'falta' then 'Registramos tu aviso como falta. Ya usaste tus 2 reprogramaciones y esta hora no se repone automáticamente. Habla con la escuela o con tu instructor en tu siguiente práctica para recuperarla.'
 when 'hora_perdida' then 'Registramos tu aviso. No hay horarios libres para reponer este bloque antes de tu fecha fin; el bloque se pierde y no consume una reprogramación.'
 else 'Registramos tu aviso para el '||(array['lun','mar','mié','jue','vie','sáb','dom'])[extract(isodow from (p_block->>'startsAt')::timestamptz at time zone 'America/Guayaquil')::integer]||' '||
 to_char((p_block->>'startsAt')::timestamptz at time zone 'America/Guayaquil','FMDD')||' '||(array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])[extract(month from (p_block->>'startsAt')::timestamptz at time zone 'America/Guayaquil')::integer]||', '||
 to_char((p_block->>'startsAt')::timestamptz at time zone 'America/Guayaquil','HH24:MI')||'–'||to_char((p_block->>'endsAt')::timestamptz at time zone 'America/Guayaquil','HH24:MI')||'. Usaste '||p_used::text||' de 2 reprogramaciones. Elige un nuevo horario en Horarios de práctica.' end $$;

create or replace function private.practice_block_instructor_notice_v14(p_instructor uuid,p_slot uuid,p_message text)
returns void language sql security invoker set search_path='' as $$
 insert into public.notifications(user_id,tipo,titulo,mensaje,practice_slot_id,scheduled_at,email_status)
 select u.id,'cambio_agenda_instructor','Cambio en tu agenda',p_message,s.id,s.scheduled_at,null
 from public.practice_slots s join public.users u on u.id=p_instructor and u.rol='instructor' and u.activo where s.id=p_slot
 on conflict(user_id,tipo,practice_slot_id) where practice_slot_id is not null and tipo<>'asistencia_corregida'
 do update set mensaje=excluded.mensaje,created_at=private.cohortes_now(),read_at=null $$;

create or replace function private.practice_block_absence_notice_v14(p_student uuid,p_slot uuid,p_block jsonb)
returns void language sql security invoker set search_path='' as $$
 insert into public.notifications(user_id,tipo,titulo,mensaje,practice_slot_id,scheduled_at,email_status)
 select a.id,'falta_registrada_admin','Falta registrada',u.nombre_completo||' · '||(p_block->>'date')||' · '||
 to_char((p_block->>'startsAt')::timestamptz at time zone 'America/Guayaquil','HH24:MI')||'–'||to_char((p_block->>'endsAt')::timestamptz at time zone 'America/Guayaquil','HH24:MI'),null,(p_block->>'startsAt')::timestamptz,null
 from public.users a cross join public.users u where a.rol='admin' and a.activo and u.id=p_student
 on conflict(user_id,tipo,practice_slot_id) where practice_slot_id is not null and tipo<>'asistencia_corregida' do nothing $$;

create or replace function private.notify_released_block_v14(p_slot uuid) returns void
language plpgsql security invoker set search_path='' as $$declare s public.practice_slots;e record;v_count integer;v_options jsonb;begin
 select * into s from public.practice_slots where id=p_slot;
 if not public.practice_slot_window_open(s.scheduled_at,private.cohortes_now()) then return;end if;
 for e in select id,student_id from public.enrollments where cohort_id=s.cohort_id and status='activo' loop
 begin
 v_options:=private.practice_block_options_v14(e.id);
 select count(distinct(o->>'startsAt')||':'||(o->>'instructorId')) into v_count from jsonb_array_elements(v_options) o where o->>'kind'='released';
 if v_count>0 and exists(select 1 from jsonb_array_elements(v_options) o
 where o->>'kind'='released' and (o->>'startsAt')::timestamptz=s.scheduled_at and (o->>'instructorId')::uuid=s.instructor_id) then
 insert into public.notifications(user_id,tipo,titulo,mensaje,practice_slot_id,scheduled_at,block_offer_group)
 values(e.student_id,'cupo_disponible',case when v_count=1 then '1 cupo nuevo' else v_count::text||' cupos nuevos' end,
 'Abre Cupos disponibles en Horarios de práctica para reponer o cambiar un bloque completo.',null,s.scheduled_at,e.id)
 on conflict(user_id,block_offer_group) where tipo='cupo_disponible' and block_offer_group is not null
 do update set titulo=excluded.titulo,mensaje=excluded.mensaje,practice_slot_id=excluded.practice_slot_id,scheduled_at=excluded.scheduled_at,created_at=private.cohortes_now(),read_at=null;
 end if;
 exception when sqlstate 'CD409' then null;end;
 end loop;
end $$;

-- Una sola consulta para chips y ficha del administrador, con autorización explícita.
create or replace function public.admin_practice_absences_v14(p_actor uuid,p_student uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$declare r jsonb;begin
 if not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then raise exception 'Se requiere administrador activo' using errcode='CD403';end if;
 select coalesce(jsonb_agg(jsonb_build_object('studentId',u.id,'name',u.nombre_completo,
 'count',(select count(*) from public.practice_slot_cancellations c where c.student_id=u.id and c.resultado='falta'),
 'enrollments',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'used',e.reprogramaciones_usadas,'absences',
 (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'date',coalesce(c.block_local_date,(c.slot_starts_at at time zone 'America/Guayaquil')::date),'startsAt',c.slot_starts_at,'hours',coalesce(c.block_hours,1)) order by c.slot_starts_at desc),'[]') from public.practice_slot_cancellations c where c.enrollment_id=e.id and c.resultado='falta'))),'[]') from public.enrollments e where e.student_id=u.id))),'[]') into r
 from public.users u where u.rol='estudiante' and(p_student is null or u.id=p_student) and(p_student is not null or exists(select 1 from public.practice_slot_cancellations c where c.student_id=u.id and c.resultado='falta'));
 return r;
end $$;

CREATE OR REPLACE FUNCTION public.cancel_practice_block_with_reason_v14(p_student uuid, p_enrollment uuid, p_date date, p_category text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
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
 if (b->>'startsAt')::timestamptz<=private.cohortes_now() then raise exception 'Este bloque ya comenzó y no se puede cancelar desde la plataforma' using errcode='CD409';end if;
 v_result:=v_preview->>'result';v_late:=not public.practice_slot_window_open((b->>'startsAt')::timestamptz,private.cohortes_now());
 if v_result='reprogramable' then update public.enrollments set reprogramaciones_usadas=reprogramaciones_usadas+1 where id=e.id and reprogramaciones_usadas<2 returning reprogramaciones_usadas into v_number;
 if not found then raise exception 'El contador cambió; vuelve a consultar' using errcode='CD409';end if;end if;
 insert into public.practice_slot_cancellations(slot_id,enrollment_id,student_id,instructor_id,cohort_id,slot_starts_at,cancelled_at,
 motivo_categoria,motivo_texto,resultado,consumio_reprogramacion,reprogramacion_numero,block_slot_ids,block_hours,block_local_date)
 values(v_ids[1],e.id,p_student,(b->>'instructorId')::uuid,e.cohort_id,(b->>'startsAt')::timestamptz,private.cohortes_now(),p_category,btrim(p_reason),v_result,v_result='reprogramable',v_number,v_ids,(b->>'hours')::integer,p_date) returning id into v_id;
 update public.practice_slots set student_id=null,status=case when v_late then 'sin_practica'::public.practice_slot_status else 'liberado'::public.practice_slot_status end,
 confirmed_at=null,confirmation_notified_at=null,release_notified_at=null where id=any(v_ids);
 perform private.enqueue_practice_notification(p_student,'resultado_cancelacion','Aviso de inasistencia registrado',private.practice_block_result_message_v14(b,v_result,coalesce(v_number,e.reprogramaciones_usadas)),v_ids[1],(b->>'startsAt')::timestamptz,false);
 if v_late then perform private.enqueue_practice_notification((b->>'instructorId')::uuid,'sin_practica_instructor','No habrá práctica en este bloque','El alumno avisó que no asistirá al bloque.',v_ids[1],(b->>'startsAt')::timestamptz,true);
 else perform private.notify_released_block_v14(v_ids[1]);end if;
 perform private.practice_block_instructor_notice_v14((b->>'instructorId')::uuid,v_ids[1],'Cambio en tu agenda: el alumno avisó que no asistirá al bloque completo.');
 if v_result='falta' then perform private.practice_block_absence_notice_v14(p_student,v_ids[1],b);end if;
 return jsonb_build_object('cohortId',e.cohort_id,'audience',(select coalesce(jsonb_agg(distinct user_id),'[]') from public.notifications where practice_slot_id=any(v_ids) or block_offer_group in(select id from public.enrollments where cohort_id=e.cohort_id) or(tipo='falta_registrada_admin' and scheduled_at=(b->>'startsAt')::timestamptz)),'block',b,'cancellationId',v_id,'result',v_result,'used',coalesce(v_number,e.reprogramaciones_usadas),'remaining',2-coalesce(v_number,e.reprogramaciones_usadas),'effect',private.practice_block_result_message_v14(b,v_result,coalesce(v_number,e.reprogramaciones_usadas)));
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

CREATE OR REPLACE FUNCTION private.base_scheduler_transition_v14(p_slot_id uuid, p_transition text, p_expected_version text)
 RETURNS SETOF practice_slots
 LANGUAGE plpgsql
 SECURITY INVOKER
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

create or replace function public.transition_practice_slot_for_scheduler(p_slot_id uuid,p_transition text,p_expected_version text)
 returns setof public.practice_slots language plpgsql security invoker set search_path='' as $$declare c public.practice_slot_cancellations;begin
 if p_transition='close' then
 select * into c from public.practice_slot_cancellations where p_slot_id=any(block_slot_ids) order by cancelled_at desc,id limit 1;
 if found then
 perform 1 from public.practice_slots where id=any(c.block_slot_ids) order by id for update;
 if not exists(select 1 from public.practice_slots where id=p_slot_id and xmin::text=p_expected_version and status='liberado') or c.slot_starts_at>private.cohortes_now()+interval '5 minutes' then return;end if;
 if exists(select 1 from public.practice_slots where id=any(c.block_slot_ids) and(status<>'liberado' or student_id is not null)) then return;end if;
 update public.practice_slots set status='sin_practica',confirmed_at=null,confirmation_notified_at=null where id=any(c.block_slot_ids);
 perform private.enqueue_practice_notification(c.instructor_id,'sin_practica_instructor','No habrá práctica en este bloque','El bloque liberado sigue vacío y queda sin práctica.',c.slot_id,c.slot_starts_at,true);
 return query select * from public.practice_slots where id=p_slot_id;return;end if;end if;
 return query select * from private.base_scheduler_transition_v14(p_slot_id,p_transition,p_expected_version);
 end $$;

-- Todas las funciones C14 son exclusivas del backend, incluidas las llamadas por disparadores.
do $acl$ declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in ('practice_block_result_message_v14','practice_block_instructor_notice_v14','practice_block_absence_notice_v14','notify_released_block_v14','admin_practice_absences_v14','cancel_practice_block_with_reason_v14','take_practice_block_v14','base_scheduler_transition_v14','transition_practice_slot_for_scheduler') loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end $acl$;
CREATE OR REPLACE FUNCTION private.practice_block_v14(p_student uuid, p_enrollment uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
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
 'started',b.starts<=private.cohortes_now());
end $function$
;
revoke all on function private.practice_block_v14(uuid,uuid,date) from public,anon,authenticated;
grant execute on function private.practice_block_v14(uuid,uuid,date) to service_role;
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
 and not exists(select 1 from public.practice_slots s where s.student_id=e.student_id and s.status in('asignado','confirmado','completado')
 and (s.scheduled_at at time zone 'America/Guayaquil')::date=(t.starts at time zone 'America/Guayaquil')::date
 and (s.scheduled_at at time zone 'America/Guayaquil')::date is distinct from coalesce(p_cancel_date,src.source_day))
 and not exists(select 1 from public.practice_slots s where s.student_id=e.student_id and s.status in('asignado','confirmado','completado')
 and (p_cancel_date is null or (s.scheduled_at at time zone 'America/Guayaquil')::date<>p_cancel_date)
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
revoke all on function private.practice_block_options_v14(uuid,date) from public,anon,authenticated;
grant execute on function private.practice_block_options_v14(uuid,date) to service_role;
CREATE OR REPLACE FUNCTION public.confirm_practice_block_v14(p_student uuid, p_enrollment uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$declare b jsonb;ids uuid[];begin
 perform private.lock_student_schedule_v12(p_student);perform private.assert_student_not_deleting(p_student);
 b:=private.practice_block_v14(p_student,p_enrollment,p_date);
 if (b->>'startsAt')::timestamptz<=private.cohortes_now() then raise exception 'Este bloque ya comenzó' using errcode='CD409';end if;
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(b->'slotIds');
 perform 1 from public.practice_slots where id=any(ids) order by id for update;
 update public.practice_slots set status='confirmado',confirmed_at=private.cohortes_now() where id=any(ids) and student_id=p_student and status in('asignado','confirmado');
 return b||jsonb_build_object('confirmed',true);
end $function$
;
revoke all on function confirm_practice_block_v14(uuid,uuid,date) from public,anon,authenticated;
grant execute on function confirm_practice_block_v14(uuid,uuid,date) to service_role;
drop policy if exists notifications_broadcast_v14 on realtime.messages;
create policy notifications_broadcast_v14 on realtime.messages for select to authenticated using(extension='broadcast' and realtime.topic()='user-'||auth.uid()::text||'-notifications' and exists(select 1 from public.users where id=auth.uid() and activo));
create or replace function public.instructor_practice_blocks_v14(p_actor uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$declare r jsonb;begin
 if not exists(select 1 from public.users where id=p_actor and rol='instructor' and activo) then raise exception 'Se requiere instructor activo' using errcode='CD403';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>31 then raise exception 'Consulta como máximo 31 días de agenda' using errcode='22023';end if;
 with identified as (
 select s.*,case when s.student_id is not null then s.student_id::text||':'||s.cohort_id::text||':'||(s.scheduled_at at time zone 'America/Guayaquil')::date::text
 else coalesce('liberado:'||c.id::text,'franja:'||s.id::text) end block_key from public.practice_slots s
 left join lateral(select id from public.practice_slot_cancellations a where s.id=any(a.block_slot_ids) order by a.cancelled_at desc,a.id limit 1) c on true
 where s.instructor_id=p_actor and(s.scheduled_at at time zone 'America/Guayaquil')::date between p_from and p_to
 ), blocks as(select block_key,min(scheduled_at) starts,max(scheduled_at)+interval '1 hour' ends,array_agg(id order by scheduled_at) ids,count(*) hours from identified group by block_key)
 select coalesce(jsonb_agg(jsonb_build_object('id',block_key,'slotIds',ids,'startsAt',starts,'endsAt',ends,'hours',hours) order by starts),'[]') into r from blocks;
 return r;
end $$;
revoke all on function public.instructor_practice_blocks_v14(uuid,date,date) from public,anon,authenticated;
grant execute on function public.instructor_practice_blocks_v14(uuid,date,date) to service_role;

-- El historial conserva una entrada por auditoría y cuenta todas las horas del bloque.
CREATE OR REPLACE FUNCTION public.student_practice_history(p_student uuid, p_enrollment uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
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
    select 'cancellation:' || c.id::text, c.slot_id, c.id, c.slot_starts_at, 60*coalesce(c.block_hours,1), null::text, null::boolean,
      case when c.resultado = 'falta' then 'falta'
        when c.resultado = 'reprogramable' and c.repuesto_en is null then 'liberada' else 'cancelada' end,
      c.resultado, c.motivo_texto, 0, case when c.resultado in ('hora_perdida', 'falta') then 60*coalesce(c.block_hours,1) else 0 end
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
revoke all on function public.student_practice_history(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.student_practice_history(uuid,uuid,integer,integer) to service_role;
do $$begin if not exists(select 1 from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_blocks_inbox_only_v14') then
 alter table public.notifications add constraint notifications_blocks_inbox_only_v14 check(tipo not in('cambio_agenda_instructor','falta_registrada_admin') or email_status is null);end if;end $$;
notify pgrst, 'reload schema';
commit;
