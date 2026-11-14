-- Solo lectura; guardar esta salida antes de aplicar.
select current_database(),current_user;
select 'private.resolve_item_access(uuid,uuid)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.resolve_item_access(uuid,uuid)');
select 'content_start_attempt(uuid,uuid)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('content_start_attempt(uuid,uuid)');
select 'content_student(uuid,text,jsonb)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('content_student(uuid,text,jsonb)');
select 'private.content_student(uuid,text,jsonb)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.content_student(uuid,text,jsonb)');
select 'private.start_exam_attempt(uuid,uuid)' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.start_exam_attempt(uuid,uuid)');
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in('public.material_progress'::regclass,'public.exam_attempts'::regclass,'public.subject_items'::regclass);
select count(*) filas_material_progress,count(completed_at) completados from public.material_progress;
select m.id,m.subject_id,m.order_index from public.subject_items m where m.kind='material' and m.obligatorio and m.order_index is null;
