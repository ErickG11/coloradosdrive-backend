-- Solo lectura; guardar esta salida antes de aplicar.
select current_database(),current_user;
select e.id,e.student_id,e.practice_plan,e.practice_start_date,e.practice_end_date,e.horas_practica_objetivo,e.reprogramaciones_usadas from public.enrollments e order by e.id;
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in('public.enrollments'::regclass,'public.practice_slots'::regclass,'public.practice_slot_cancellations'::regclass,'public.notifications'::regclass);
select 'private.practice_replacement_balance(uuid)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.practice_replacement_balance(uuid)');
select 'private.free_instructors_v2(timestamp with time zone[],uuid,uuid)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.free_instructors_v2(timestamp with time zone[],uuid,uuid)');
