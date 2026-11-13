-- Solo lectura; guardar esta salida antes de aplicar.
select current_database(),current_user;
select e.id,e.student_id,e.practice_plan,e.practice_start_date,e.practice_end_date,e.horas_practica_objetivo,e.reprogramaciones_usadas from public.enrollments e order by e.id;
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in('public.enrollments'::regclass,'public.practice_slots'::regclass,'public.practice_slot_cancellations'::regclass,'public.notifications'::regclass);
select 'private.notify_released_block_v14(uuid)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.notify_released_block_v14(uuid)');
select 'cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)');
select 'take_practice_block_v14(uuid,uuid,text)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('take_practice_block_v14(uuid,uuid,text)');
select 'transition_practice_slot_for_scheduler(uuid,text,text)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('transition_practice_slot_for_scheduler(uuid,text,text)');
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.notifications'::regclass;
select indexname,indexdef from pg_indexes where tablename in('notifications','practice_slots','practice_slot_cancellations');
select 'private.practice_block_v14(uuid,uuid,date)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.practice_block_v14(uuid,uuid,date)');
select 'private.practice_block_options_v14(uuid,date)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.practice_block_options_v14(uuid,date)');
select 'confirm_practice_block_v14(uuid,uuid,date)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('confirm_practice_block_v14(uuid,uuid,date)');
select 'student_practice_history(uuid,uuid,integer,integer)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('student_practice_history(uuid,uuid,integer,integer)');
select id,user_id,tipo,practice_slot_id,scheduled_at,email_status from public.notifications where tipo in('cupo_disponible','sin_practica_instructor');
