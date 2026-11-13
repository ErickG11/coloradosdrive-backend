-- C17. Aplicación manual; sin activar indicadores. Requiere aplicadas la 001 a la 091.
begin;
set local lock_timeout='5s';
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.practice_block_v14(uuid,uuid,date)');if h is null or (h is distinct from '884fb434efa35e480627daa4d92f1814') then raise exception 'GUARDA_092: no coincide con la instalación esperada: private.practice_block_v14(uuid,uuid,date)';end if;end $guard$;
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.notify_released_block_v14(uuid)');if h is null or (h is distinct from '1ece6f5e6cd66087ea65e8b29f826fbb') then raise exception 'GUARDA_092: no coincide con la instalación esperada: private.notify_released_block_v14(uuid)';end if;end $guard$;
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.practice_block_instructor_notice_v14(uuid,uuid,text)');if h is null or (h is distinct from '318b205fca48cd7b7707779dbe95e1e9') then raise exception 'GUARDA_092: no coincide con la instalación esperada: private.practice_block_instructor_notice_v14(uuid,uuid,text)';end if;end $guard$;
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.practice_block_absence_notice_v14(uuid,uuid,jsonb)');if h is null or (h is distinct from '47c6819d802f7333e64819b6858989da') then raise exception 'GUARDA_092: no coincide con la instalación esperada: private.practice_block_absence_notice_v14(uuid,uuid,jsonb)';end if;end $guard$;
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.free_instructors_v2(timestamp with time zone[],uuid,uuid)');if h is null or (h is distinct from '231b1953a2b029dcf350147fa2d92b02') then raise exception 'GUARDA_092: no coincide con la instalación esperada: private.free_instructors_v2(timestamp with time zone[],uuid,uuid)';end if;end $guard$;
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.practice_block_options_v14(uuid,date)');if h is null or (h is distinct from 'acb4a4722fd4c32746b2da0acbbcd737' and h is distinct from 'c1a5007099b04d0d4be142502f181396') then raise exception 'GUARDA_092: no coincide con la instalación esperada: private.practice_block_options_v14(uuid,date)';end if;end $guard$;
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('take_practice_block_v14(uuid,uuid,text)');if h is null or (h is distinct from '8cb5513f1f4f47c5c12eb97973f1c6af' and h is distinct from '7f7fab465f4d7c629b85465780a639a3') then raise exception 'GUARDA_092: no coincide con la instalación esperada: take_practice_block_v14(uuid,uuid,text)';end if;end $guard$;
-- GUARDA-C17-NUEVAS INICIO
do $guard$ begin if to_regprocedure('private.practice_day_label_v17(timestamp with time zone)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_day_label_v17(timestamp with time zone)')) is distinct from '73e61b6c03b4776b1be89ab81a555cc7' then raise exception 'GUARDA_092: función C17 alterada: private.practice_day_label_v17(timestamp with time zone)';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.practice_range_label_v17(timestamp with time zone,integer)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_range_label_v17(timestamp with time zone,integer)')) is distinct from '27008205bb90afabbd5d9a7602e8cd7b' then raise exception 'GUARDA_092: función C17 alterada: private.practice_range_label_v17(timestamp with time zone,integer)';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.practice_result_notice_v17(uuid,text,text,text,uuid,timestamp with time zone)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_result_notice_v17(uuid,text,text,text,uuid,timestamp with time zone)')) is distinct from '37b3afcd34a77098a33f0e316e38a0f7' then raise exception 'GUARDA_092: función C17 alterada: private.practice_result_notice_v17(uuid,text,text,text,uuid,timestamp with time zone)';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.practice_day_options_v17(uuid,date)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.practice_day_options_v17(uuid,date)')) is distinct from 'fabf0bbe77adef60ed32247c0e4a2184' then raise exception 'GUARDA_092: función C17 alterada: private.practice_day_options_v17(uuid,date)';end if;end $guard$;
do $guard$ begin if to_regprocedure('preview_practice_block_resolution_v17(uuid,uuid,date)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('preview_practice_block_resolution_v17(uuid,uuid,date)')) is distinct from '88afc2b1f25acdef773834e3e8028772' then raise exception 'GUARDA_092: función C17 alterada: preview_practice_block_resolution_v17(uuid,uuid,date)';end if;end $guard$;
do $guard$ begin if to_regprocedure('resolve_practice_block_v17(uuid,uuid,date,text,timestamp with time zone,text,text)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('resolve_practice_block_v17(uuid,uuid,date,text,timestamp with time zone,text,text)')) is distinct from '5830d65348aa442de0a95842895b9393' then raise exception 'GUARDA_092: función C17 alterada: resolve_practice_block_v17(uuid,uuid,date,text,timestamp with time zone,text,text)';end if;end $guard$;
-- GUARDA-C17-NUEVAS FIN
-- Auditoría: la acción elegida por el alumno. Nula en las filas anteriores.
alter table public.practice_slot_cancellations add column if not exists accion text;
do $$begin if not exists(select 1 from pg_constraint where conname='practice_cancellation_accion_v17') then
 alter table public.practice_slot_cancellations add constraint practice_cancellation_accion_v17 check(accion is null or accion in('mover','falta','tomar_cupo'));end if;end $$;
grant insert(accion) on public.practice_slot_cancellations to service_role;
grant insert(user_id,tipo,titulo,mensaje,practice_slot_id,scheduled_at,email_status,block_offer_group) on public.notifications to service_role;
grant update(titulo,mensaje,practice_slot_id,scheduled_at,created_at,read_at,block_offer_group) on public.notifications to service_role;

create or replace function private.practice_day_label_v17(p_at timestamptz) returns text
language sql stable security invoker set search_path='' as $function$
select (array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[extract(isodow from p_at at time zone 'America/Guayaquil')::integer]||' '||
 to_char(p_at at time zone 'America/Guayaquil','FMDD')||' de '||(array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from p_at at time zone 'America/Guayaquil')::integer] $function$;

create or replace function private.practice_range_label_v17(p_start timestamptz,p_hours integer) returns text
language sql stable security invoker set search_path='' as $function$
select to_char(p_start at time zone 'America/Guayaquil','HH24:MI')||'–'||to_char((p_start+make_interval(hours=>p_hours)) at time zone 'America/Guayaquil','HH24:MI') $function$;

-- Aviso de bandeja con texto actualizable; nunca encola correo.
create or replace function private.practice_result_notice_v17(p_user uuid,p_type text,p_title text,p_message text,p_slot uuid,p_at timestamptz) returns void
language sql volatile security invoker set search_path='' as $function$
insert into public.notifications(user_id,tipo,titulo,mensaje,practice_slot_id,scheduled_at,email_status)
select u.id,p_type,p_title,p_message,p_slot,p_at,null from public.users u where u.id=p_user and u.activo
on conflict(user_id,tipo,practice_slot_id) where practice_slot_id is not null and tipo<>'asistencia_corregida'
do update set titulo=excluded.titulo,mensaje=excluded.mensaje,scheduled_at=excluded.scheduled_at,created_at=private.cohortes_now(),read_at=null $function$;

-- U2: horas libres del MISMO instructor, en la MISMA fecha, con la misma duración.
create or replace function private.practice_day_options_v17(p_enrollment uuid,p_date date) returns jsonb
language plpgsql volatile security invoker set search_path='' as $function$
declare e public.enrollments;b jsonb;v_hours integer;v_instructor uuid;v_start timestamptz;v_now timestamptz;v_top integer;v_plan_end date;r jsonb;begin
 select * into e from public.enrollments where id=p_enrollment and status='activo';
 if not found then return '[]';end if;
 b:=private.practice_block_v14(e.student_id,e.id,p_date);
 v_hours:=(b->>'hours')::integer;v_instructor:=(b->>'instructorId')::uuid;v_start:=(b->>'startsAt')::timestamptz;
 v_now:=private.cohortes_now();v_top:=coalesce((select practicas_hora_fin from public.app_settings where id),22);
 v_plan_end:=nullif(e.practice_plan->>'fechaFinElegida','')::date;
 if v_plan_end is not null and p_date>v_plan_end then return '[]';end if;
 select coalesce(jsonb_agg(jsonb_build_object('startsAt',t.starts,'endsAt',t.starts+make_interval(hours=>v_hours),'hours',v_hours,
 'instructorId',v_instructor,'instructorName',(select nombre_completo from public.users where id=v_instructor)) order by t.starts),'[]') into r
 from (select (p_date::timestamp+make_interval(hours=>h)) at time zone 'America/Guayaquil' starts from generate_series(6,v_top-v_hours) h) t
 where t.starts>v_now+interval '5 minutes' and t.starts<>v_start
 and not exists(select 1 from public.practice_slots s where s.student_id=e.student_id and s.status in('asignado','confirmado','completado')
 and s.scheduled_at<t.starts+make_interval(hours=>v_hours) and s.scheduled_at+interval '1 hour'>t.starts)
 and not exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations rr on rr.id=h.reservation_id
 where rr.student_id=e.student_id and h.released_at is null and(h.payment_protected or h.expira_at>v_now)
 and h.scheduled_at<t.starts+make_interval(hours=>v_hours) and h.scheduled_at+interval '1 hour'>t.starts)
 and exists(select 1 from private.free_instructors_v2(array(select t.starts+make_interval(hours=>k) from generate_series(0,v_hours-1) k),e.student_id,null) i where i.id=v_instructor);
 return r;
end $function$;

-- U5: solo cupos liberados de la misma cohorte, mismo instructor, misma fecha y duración que un bloque propio.
create or replace function private.practice_block_options_v14(p_enrollment uuid,p_cancel_date date default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $function$
declare e public.enrollments;v_end date;v_now timestamptz;v_top integer;v_result jsonb;begin
 select * into e from public.enrollments where id=p_enrollment and status='activo';
 if not found then return '[]';end if;
 if not exists(select 1 from public.users where id=e.student_id and rol='estudiante' and activo) then return '[]';end if;
 if coalesce(e.practice_plan->>'horasPorDia','') !~ '^[12]$' or e.practice_plan->>'modalidad' not in('entre_semana','fin_de_semana')
 or e.practice_plan->>'fechaFinElegida' is null then
 raise exception 'La matrícula no tiene un contrato de prácticas demostrable; consulta con la escuela' using errcode='CD409';end if;
 -- Compatibilidad: el flujo anterior de cancelar y reponer después ya no ofrece opciones.
 if p_cancel_date is not null or e.reprogramaciones_usadas>=2 then return '[]';end if;
 v_end:=(e.practice_plan->>'fechaFinElegida')::date;v_now:=private.cohortes_now();
 v_top:=coalesce((select practicas_hora_fin from public.app_settings where id),22);
 with own_blocks as (
 select (s.scheduled_at at time zone 'America/Guayaquil')::date source_day,min(s.scheduled_at) starts,count(*)::integer hours,
 (array_agg(s.instructor_id order by s.scheduled_at))[1] instructor
 from public.practice_slots s where s.student_id=e.student_id and s.cohort_id=e.cohort_id and s.status in('asignado','confirmado')
 group by 1 having count(*) in(1,2) and count(distinct s.instructor_id)=1
 and max(s.scheduled_at)-min(s.scheduled_at)=make_interval(hours=>count(*)::integer-1)
 ), released as (
 select distinct c.instructor_id instructor,c.slot_starts_at starts,c.block_hours::integer hours
 from public.practice_slot_cancellations c where c.cohort_id=e.cohort_id and c.block_slot_ids is not null
 and not exists(select 1 from unnest(c.block_slot_ids) x left join public.practice_slots s on s.id=x
 where s.id is null or s.student_id is not null or s.status not in('liberado','disponible') or s.instructor_id<>c.instructor_id or s.cohort_id is distinct from e.cohort_id)
 ), candidates as (
 select o.source_day,o.starts source_start,o.hours,o.instructor,r.starts target_start,
 (select nombre_completo from public.users where id=r.instructor) instructor_name
 from own_blocks o join released r on r.instructor=o.instructor and r.hours=o.hours
 and (r.starts at time zone 'America/Guayaquil')::date=o.source_day and r.starts<>o.starts
 where o.starts>v_now+interval '5 minutes' and r.starts>v_now+interval '5 minutes'
 and o.source_day<=v_end
 and extract(hour from r.starts at time zone 'America/Guayaquil')>=6
 and extract(hour from r.starts at time zone 'America/Guayaquil')+o.hours<=v_top
 and not exists(select 1 from public.practice_slot_cancellations c where c.student_id=e.student_id and c.block_slot_ids is not null and c.slot_starts_at=r.starts)
 and not exists(select 1 from public.practice_slots s where s.student_id=e.student_id and s.status in('asignado','confirmado','completado')
 and s.scheduled_at<r.starts+make_interval(hours=>o.hours) and s.scheduled_at+interval '1 hour'>r.starts)
 and not exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations rr on rr.id=h.reservation_id
 where rr.student_id=e.student_id and h.released_at is null and(h.payment_protected or h.expira_at>v_now)
 and h.scheduled_at<r.starts+make_interval(hours=>o.hours) and h.scheduled_at+interval '1 hour'>r.starts)
 and exists(select 1 from private.free_instructors_v2(array(select r.starts+make_interval(hours=>k) from generate_series(0,o.hours-1) k),e.student_id,null) i where i.id=r.instructor)
 )
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',md5(e.id::text||instructor::text||extract(epoch from target_start)::text||source_day::text),
 'enrollmentId',e.id,'cohortId',e.cohort_id,'startsAt',target_start,'endsAt',target_start+make_interval(hours=>hours),
 'hours',hours,'instructorId',instructor,'instructorName',instructor_name,'kind','released',
 'sourceDate',source_day,'sourceStartsAt',source_start,'pendingId',null,'cost',1,'remaining',2-e.reprogramaciones_usadas-1)
 order by target_start,source_day),'[]') into v_result from candidates;
 return v_result;
end $function$;

-- U5/U6: tomar un cupo liberado solo el mismo día, con el mismo instructor, en la misma cohorte.
create or replace function public.take_practice_block_v14(p_student uuid,p_enrollment uuid,p_option text)
returns jsonb language plpgsql volatile security invoker set search_path='' set lock_timeout='5s' as $function$
declare e public.enrollments;o jsonb;source jsonb;source_ids uuid[];target_ids uuid[]:='{}';v_slot uuid;t timestamptz;
 v_starts timestamptz;v_instructor uuid;v_hours integer;v_number smallint;v_cancel uuid;v_free integer;begin
 perform private.lock_student_schedule_v12(p_student);perform private.assert_student_not_deleting(p_student);
 perform 1 from public.users where id=p_student and activo and rol='estudiante' for update;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student and status='activo' for update;
 if not found then raise exception 'No tienes una matrícula activa para este bloque' using errcode='CD403';end if;
 perform 1 from public.cohorts where id=e.cohort_id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 select value into o from jsonb_array_elements(private.practice_block_options_v14(e.id)) where value->>'id'=p_option;
 if o is null then raise exception 'Otro alumno tomó este cupo o ya no está disponible. Vuelve a consultar.' using errcode='CD409';end if;
 v_starts:=(o->>'startsAt')::timestamptz;v_instructor:=(o->>'instructorId')::uuid;v_hours:=(o->>'hours')::integer;
 source:=private.practice_block_v14(p_student,e.id,(o->>'sourceDate')::date);
 if (source->>'started')::boolean then raise exception 'El bloque que ibas a cambiar ya comenzó' using errcode='CD409';end if;
 if (source->>'instructorId')::uuid<>v_instructor or (source->>'hours')::integer<>v_hours
 or (v_starts at time zone 'America/Guayaquil')::date<>(o->>'sourceDate')::date then
 raise exception 'El cupo debe ser del mismo día, con tu mismo instructor y la misma duración' using errcode='CD409';end if;
 select array_agg(value::uuid) into source_ids from jsonb_array_elements_text(source->'slotIds');
 perform 1 from public.practice_slots s where s.id=any(source_ids) or(s.instructor_id=v_instructor and s.scheduled_at>=v_starts and s.scheduled_at<v_starts+make_interval(hours=>v_hours)) order by s.id for update;
 select count(*) into v_free from public.practice_slots s where s.instructor_id=v_instructor and s.scheduled_at>=v_starts and s.scheduled_at<v_starts+make_interval(hours=>v_hours)
 and s.student_id is null and s.status in('liberado','disponible') and s.cohort_id=e.cohort_id;
 if v_free<>v_hours then raise exception 'Otro alumno tomó este cupo o ya no está disponible. Vuelve a consultar.' using errcode='CD409';end if;
 update public.practice_slots set student_id=null,status='liberado',confirmed_at=null,confirmation_notified_at=null,release_notified_at=null where id=any(source_ids);
 update public.enrollments set reprogramaciones_usadas=reprogramaciones_usadas+1 where id=e.id and reprogramaciones_usadas<2 returning reprogramaciones_usadas into v_number;
 if not found then raise exception 'Ya usaste tus 2 reprogramaciones' using errcode='CD409';end if;
 if not exists(select 1 from private.free_instructors_v2(array(select v_starts+make_interval(hours=>k) from generate_series(0,v_hours-1) k),p_student,null) where id=v_instructor) then
 raise exception 'Otro alumno tomó este cupo o está reservado por una inscripción. Vuelve a consultar.' using errcode='CD409';end if;
 for t in select v_starts+make_interval(hours=>k) from generate_series(0,v_hours-1) k loop
 select id into v_slot from public.practice_slots where instructor_id=v_instructor and scheduled_at=t and student_id is null and status in('disponible','liberado') and cohort_id=e.cohort_id order by id limit 1;
 update public.practice_slots set cohort_id=e.cohort_id,student_id=p_student,status='asignado',confirmed_at=null,confirmation_notified_at=null,release_notified_at=null where id=v_slot;
 target_ids:=array_append(target_ids,v_slot);
 end loop;
 insert into public.practice_slot_cancellations(slot_id,enrollment_id,student_id,instructor_id,cohort_id,slot_starts_at,cancelled_at,motivo_categoria,motivo_texto,resultado,consumio_reprogramacion,reprogramacion_numero,origen,repuesto_por_slot_id,repuesto_en,block_slot_ids,block_hours,block_local_date,accion)
 values(source_ids[1],e.id,p_student,(source->>'instructorId')::uuid,e.cohort_id,(source->>'startsAt')::timestamptz,private.cohortes_now(),'otro','Cambio del bloque por un cupo liberado del mismo día','reprogramable',true,v_number,'cambio_cupo',target_ids[1],private.cohortes_now(),source_ids,v_hours,(source->>'date')::date,'tomar_cupo') returning id into v_cancel;
 perform private.notify_released_block_v14(source_ids[1]);
 perform private.practice_result_notice_v17(p_student,'cambio_realizado','Horario actualizado',
 'Cambiamos tu bloque del '||private.practice_day_label_v17(v_starts)||' de '||private.practice_range_label_v17((source->>'startsAt')::timestamptz,v_hours)||' a '||private.practice_range_label_v17(v_starts,v_hours)||' con '||(select nombre_completo from public.users where id=v_instructor)||'. Usaste '||v_number::text||' de 2 reprogramaciones.',target_ids[1],v_starts);
 perform private.practice_block_instructor_notice_v14(v_instructor,target_ids[1],'Cambio en tu agenda: un alumno tomó este bloque completo.');
 perform private.practice_block_instructor_notice_v14((source->>'instructorId')::uuid,source_ids[1],'Cambio en tu agenda: el alumno cambió este bloque y quedó libre.');
 return jsonb_build_object('cohortId',e.cohort_id,'audience',(select coalesce(jsonb_agg(distinct user_id),'[]') from public.notifications where practice_slot_id=any(target_ids||source_ids) or block_offer_group in(select id from public.enrollments where cohort_id=e.cohort_id)),'option',o,'slotIds',target_ids,'source',source,'used',v_number,'remaining',2-v_number,'cancellationId',v_cancel);
end $function$;

-- U4: vista previa sin escritura de las dos salidas del bloque del día.
create or replace function public.preview_practice_block_resolution_v17(p_student uuid,p_enrollment uuid,p_date date) returns jsonb
language plpgsql volatile security invoker set search_path='' as $function$
declare e public.enrollments;b jsonb;v_start timestamptz;v_hours integer;v_started boolean;v_late boolean;v_free jsonb:='[]';v_reason text;begin
 b:=private.practice_block_v14(p_student,p_enrollment,p_date);
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student;
 v_start:=(b->>'startsAt')::timestamptz;v_hours:=(b->>'hours')::integer;
 v_started:=v_start<=private.cohortes_now();v_late:=not v_started and not public.practice_slot_window_open(v_start,private.cohortes_now());
 if v_started then v_reason:='Este bloque ya comenzó y no se puede avisar desde la plataforma.';
 elsif v_late then v_reason:='Faltan 5 minutos o menos para tu práctica: solo puedes avisar que no asistirás.';
 elsif e.reprogramaciones_usadas>=2 then v_reason:='Ya usaste tus 2 reprogramaciones.';
 else v_free:=private.practice_day_options_v17(e.id,p_date);
 if jsonb_array_length(v_free)=0 then v_reason:='Tu instructor no tiene otra hora libre ese día.';end if;end if;
 return jsonb_build_object('block',b,'started',v_started,'late',v_late,'used',e.reprogramaciones_usadas,'remaining',2-e.reprogramaciones_usadas,
 'canMove',v_reason is null,'moveReason',v_reason,'freeHours',case when v_reason is null then v_free else '[]'::jsonb end,
 'effectMove','Cambiarás tu bloque del '||private.practice_day_label_v17(v_start)||' ('||private.practice_range_label_v17(v_start,v_hours)||') a otra hora libre de tu instructor ese mismo día. Usará 1 de tus 2 reprogramaciones; te quedará '||greatest(1-e.reprogramaciones_usadas,0)::text||'.',
 'effectAbsence','Se registrará como FALTA el '||private.practice_day_label_v17(v_start)||'. No consume reprogramación y esta hora no se repone automáticamente. Para reponerla en otra fecha, habla con la escuela o con tu instructor en tu siguiente práctica.');
end $function$;

-- U1 a U8: resolución atómica en un solo paso.
create or replace function public.resolve_practice_block_v17(p_student uuid,p_enrollment uuid,p_date date,p_action text,p_start timestamptz,p_category text,p_reason text)
returns jsonb language plpgsql volatile security invoker set search_path='' set lock_timeout='5s' as $function$
declare e public.enrollments;b jsonb;o jsonb;v_ids uuid[];v_new uuid[]:='{}';v_start timestamptz;v_hours integer;v_instructor uuid;v_late boolean;
 v_number smallint;v_id uuid;t timestamptz;v_slot uuid;v_effect text;v_result text;begin
 if p_action is null or p_action not in('mover','falta') then raise exception 'Elige cambiar de hora o avisar que no podrás asistir ese día' using errcode='22023';end if;
 if p_category is null or p_category not in('salud','trabajo','estudios','familiar','transporte','otro') or p_reason is null or length(btrim(p_reason))<10 then
 raise exception 'Indica una categoría válida y un motivo de al menos 10 caracteres' using errcode='22023';end if;
 if p_action='mover' and p_start is null then raise exception 'Elige la hora a la que quieres cambiar tu bloque' using errcode='22023';end if;
 perform private.lock_student_schedule_v12(p_student);perform private.assert_student_not_deleting(p_student);
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student and status='activo' for update;
 if not found then raise exception 'No tienes una matrícula activa para este bloque' using errcode='CD403';end if;
 perform 1 from public.cohorts where id=e.cohort_id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 b:=private.practice_block_v14(p_student,e.id,p_date);
 v_start:=(b->>'startsAt')::timestamptz;v_hours:=(b->>'hours')::integer;v_instructor:=(b->>'instructorId')::uuid;
 select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(b->'slotIds');
 perform 1 from public.practice_slots where id=any(v_ids) order by id for update;
 if v_start<=private.cohortes_now() then raise exception 'Este bloque ya comenzó y no se puede avisar desde la plataforma' using errcode='CD409';end if;
 v_late:=not public.practice_slot_window_open(v_start,private.cohortes_now());
 if p_action='mover' then
 if v_late then raise exception 'Faltan 5 minutos o menos para tu práctica: solo puedes avisar que no asistirás' using errcode='CD409';end if;
 if e.reprogramaciones_usadas>=2 then raise exception 'Ya usaste tus 2 reprogramaciones; solo puedes avisar que no asistirás ese día' using errcode='CD409';end if;
 select value into o from jsonb_array_elements(private.practice_day_options_v17(e.id,p_date)) where (value->>'startsAt')::timestamptz=p_start;
 if o is null then raise exception 'Esa hora ya no está libre con tu instructor ese día. Vuelve a consultar.' using errcode='CD409';end if;
 perform 1 from public.practice_slots s where s.instructor_id=v_instructor and s.scheduled_at>=p_start and s.scheduled_at<p_start+make_interval(hours=>v_hours) order by s.id for update;
 update public.practice_slots set student_id=null,status='liberado',confirmed_at=null,confirmation_notified_at=null,release_notified_at=null where id=any(v_ids);
 update public.enrollments set reprogramaciones_usadas=reprogramaciones_usadas+1 where id=e.id and reprogramaciones_usadas<2 returning reprogramaciones_usadas into v_number;
 if not found then raise exception 'El contador cambió; vuelve a consultar' using errcode='CD409';end if;
 if not exists(select 1 from private.free_instructors_v2(array(select p_start+make_interval(hours=>k) from generate_series(0,v_hours-1) k),p_student,null) where id=v_instructor) then
 raise exception 'Otra persona tomó esa hora con tu instructor. Vuelve a consultar.' using errcode='CD409';end if;
 for t in select p_start+make_interval(hours=>k) from generate_series(0,v_hours-1) k loop
 v_slot:=null;select id into v_slot from public.practice_slots where instructor_id=v_instructor and scheduled_at=t and student_id is null and status in('disponible','liberado') order by id limit 1 for update;
 if v_slot is null then insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status) values(e.cohort_id,v_instructor,p_student,t,60,'asignado') returning id into v_slot;
 else update public.practice_slots set cohort_id=e.cohort_id,student_id=p_student,status='asignado',confirmed_at=null,confirmation_notified_at=null,release_notified_at=null where id=v_slot;end if;
 v_new:=array_append(v_new,v_slot);
 end loop;
 insert into public.practice_slot_cancellations(slot_id,enrollment_id,student_id,instructor_id,cohort_id,slot_starts_at,cancelled_at,motivo_categoria,motivo_texto,resultado,consumio_reprogramacion,reprogramacion_numero,origen,repuesto_por_slot_id,repuesto_en,block_slot_ids,block_hours,block_local_date,accion)
 values(v_ids[1],e.id,p_student,v_instructor,e.cohort_id,v_start,private.cohortes_now(),p_category,btrim(p_reason),'reprogramable',true,v_number,'cambio_cupo',v_new[1],private.cohortes_now(),v_ids,v_hours,p_date,'mover') returning id into v_id;
 v_result:='reprogramado';
 v_effect:='Cambiamos tu bloque del '||private.practice_day_label_v17(v_start)||' de '||private.practice_range_label_v17(v_start,v_hours)||' a '||private.practice_range_label_v17(p_start,v_hours)||' con '||(select nombre_completo from public.users where id=v_instructor)||'. Usaste '||v_number::text||' de 2 reprogramaciones.';
 perform private.practice_result_notice_v17(p_student,'resultado_cancelacion','Cambiamos tu bloque',v_effect,v_new[1],p_start);
 perform private.practice_block_instructor_notice_v14(v_instructor,v_new[1],'Cambio en tu agenda: el alumno movió su bloque de '||private.practice_range_label_v17(v_start,v_hours)||' a '||private.practice_range_label_v17(p_start,v_hours)||'.');
 perform private.notify_released_block_v14(v_ids[1]);
 else
 insert into public.practice_slot_cancellations(slot_id,enrollment_id,student_id,instructor_id,cohort_id,slot_starts_at,cancelled_at,motivo_categoria,motivo_texto,resultado,consumio_reprogramacion,reprogramacion_numero,block_slot_ids,block_hours,block_local_date,accion)
 values(v_ids[1],e.id,p_student,v_instructor,e.cohort_id,v_start,private.cohortes_now(),p_category,btrim(p_reason),'falta',false,null,v_ids,v_hours,p_date,'falta') returning id into v_id;
 update public.practice_slots set student_id=null,status=case when v_late then 'sin_practica'::public.practice_slot_status else 'liberado'::public.practice_slot_status end,
 confirmed_at=null,confirmation_notified_at=null,release_notified_at=null where id=any(v_ids);
 v_result:='falta';v_number:=e.reprogramaciones_usadas;
 v_effect:='Registramos tu inasistencia del '||private.practice_day_label_v17(v_start)||' como falta. Esta hora no se repone automáticamente. Para reponerla en otra fecha, habla con la escuela o con tu instructor en tu siguiente práctica.';
 perform private.practice_result_notice_v17(p_student,'resultado_cancelacion','Inasistencia registrada como falta',v_effect,v_ids[1],v_start);
 if v_late then perform private.enqueue_practice_notification(v_instructor,'sin_practica_instructor','No habrá práctica en este bloque','El alumno avisó que no asistirá al bloque.',v_ids[1],v_start,true);
 else perform private.notify_released_block_v14(v_ids[1]);end if;
 perform private.practice_block_instructor_notice_v14(v_instructor,v_ids[1],'Cambio en tu agenda: el alumno no asistirá el bloque de '||private.practice_range_label_v17(v_start,v_hours)||'.');
 perform private.practice_block_absence_notice_v14(p_student,v_ids[1],b);
 end if;
 return jsonb_build_object('cohortId',e.cohort_id,'audience',(select coalesce(jsonb_agg(distinct user_id),'[]') from public.notifications where practice_slot_id=any(v_ids||v_new) or block_offer_group in(select id from public.enrollments where cohort_id=e.cohort_id) or(tipo='falta_registrada_admin' and scheduled_at=v_start)),
 'block',b,'action',p_action,'result',v_result,'used',v_number,'remaining',2-v_number,'cancellationId',v_id,'effect',v_effect,
 'newBlock',case when p_action='mover' then jsonb_build_object('startsAt',p_start,'endsAt',p_start+make_interval(hours=>v_hours),'hours',v_hours,'instructorId',v_instructor) else null end);
end $function$;

-- Funciones exclusivas del backend.
do $acl$ declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in ('practice_day_label_v17','practice_range_label_v17','practice_result_notice_v17','practice_day_options_v17','practice_block_options_v14','take_practice_block_v14','preview_practice_block_resolution_v17','resolve_practice_block_v17') loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end $acl$;
notify pgrst, 'reload schema';
commit;
