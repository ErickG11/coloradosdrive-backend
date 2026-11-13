-- Solo lectura; guardar esta salida antes de aplicar.
select current_database(),current_user;
select e.id,e.student_id,e.practice_plan,e.practice_start_date,e.practice_end_date,e.horas_practica_objetivo,e.reprogramaciones_usadas from public.enrollments e order by e.id;
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in('public.enrollments'::regclass,'public.practice_slots'::regclass,'public.practice_slot_cancellations'::regclass,'public.notifications'::regclass);
select 'private.reserve_schedule_v2(uuid,uuid,jsonb)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.reserve_schedule_v2(uuid,uuid,jsonb)');
select 'private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)');
select 'private.confirm_plan_change_v2(uuid,uuid,uuid)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.confirm_plan_change_v2(uuid,uuid,uuid)');
