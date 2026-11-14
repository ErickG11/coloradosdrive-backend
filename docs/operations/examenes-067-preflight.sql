-- SOLO LECTURA; ejecutar manualmente despues de 066b, antes de 067.
begin read only;
select count(*) preguntas_afectadas_por_columnas_nuevas from public.questions;
select count(*) examenes from public.exams;
select count(*) intentos from public.exam_attempts;
select count(*) reservas_historicas from private.content_upload_limits;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='exam-question-images';
select count(*) objetos_existentes from storage.objects where bucket_id='exam-question-images';
select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='questions' and column_name in ('image_path','image_alt');
select md5(replace(prosrc,chr(13),'')) guard_hash from pg_proc where oid=to_regprocedure('private.content_exam_guard()');
do $preflight_067$ declare v_duplicates bigint;begin
 if to_regclass('public.questions') is null or to_regclass('private.content_upload_limits') is null or
  to_regprocedure('public.content_admin(uuid,text,jsonb)') is null or
  not has_function_privilege('service_role','public.content_admin(uuid,text,jsonb)','execute') then
  raise exception '067: falta aplicar 066b';end if;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.content_exam_guard()'))
  is distinct from 'fd67e3841f8020078840f6c92fa6f3dd' then raise exception '067: guard distinto o 067 ya aplicada; revisar estado';end if;
 if exists(select 1 from storage.buckets where id='exam-question-images' and (public or name<>'exam-question-images')) then
  raise exception '067: bucket preexistente incompatible';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='image_path') then
  execute 'select count(*) from (select image_path from public.questions where image_path is not null group by image_path having count(*)>1) d' into v_duplicates;
  if v_duplicates>0 then raise exception '067: rutas duplicadas antes del indice unico';end if;
 end if;
end $preflight_067$;
rollback;
