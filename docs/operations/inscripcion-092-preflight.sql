-- Solo lectura; guardar esta salida antes de aplicar.
select current_database(),current_user;
select id,student_id,reprogramaciones_usadas,practice_plan->>'horasPorDia' horas_por_dia from public.enrollments where status='activo' order by id;
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in('public.enrollments'::regclass,'public.practice_slots'::regclass,'public.practice_slot_cancellations'::regclass,'public.notifications'::regclass);
select 'private.practice_block_v14(uuid,uuid,date)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.practice_block_v14(uuid,uuid,date)');
select 'private.notify_released_block_v14(uuid)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.notify_released_block_v14(uuid)');
select 'private.practice_block_instructor_notice_v14(uuid,uuid,text)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.practice_block_instructor_notice_v14(uuid,uuid,text)');
select 'private.practice_block_absence_notice_v14(uuid,uuid,jsonb)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.practice_block_absence_notice_v14(uuid,uuid,jsonb)');
select 'private.free_instructors_v2(timestamp with time zone[],uuid,uuid)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.free_instructors_v2(timestamp with time zone[],uuid,uuid)');
select 'private.practice_block_options_v14(uuid,date)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.practice_block_options_v14(uuid,date)');
select 'take_practice_block_v14(uuid,uuid,text)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('take_practice_block_v14(uuid,uuid,text)');
select 'accion' columna,count(*) from information_schema.columns where table_schema='public' and table_name='practice_slot_cancellations' and column_name='accion';
select id,enrollment_id,resultado,origen,repuesto_en from public.practice_slot_cancellations where resultado='reprogramable' and origen='alumno' and repuesto_en is null;
