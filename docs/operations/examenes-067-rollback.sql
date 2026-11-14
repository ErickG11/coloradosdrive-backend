-- MANUAL. Backend anterior detenido. Rechaza perdida de imagenes o archivos.
begin;
set local lock_timeout='5s';
lock table public.questions in access exclusive mode;
do $rollback_067$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.content_exam_guard()'::regprocedure) is distinct from 'c980f052e0ea3efccd45a4ac6e8cfa51' then raise exception '067: guard distinto; no revertir cambios posteriores';end if;
 if exists(select 1 from public.questions where image_path is not null or image_alt is not null) then raise exception '067: hay imagenes; retirar referencias por API antes de revertir';end if;
 if exists(select 1 from storage.objects where bucket_id='exam-question-images') then raise exception '067: bucket no vacio; revisar huerfanos y limpiar por Storage API';end if;
end $rollback_067$;
drop function public.exam_question_image(uuid,uuid,uuid,text,jsonb);
drop function private.exam_question_image(uuid,uuid,uuid,text,jsonb);
create or replace function private.content_exam_guard() returns trigger language plpgsql security definer set search_path='' as $content_exam_guard_original$
declare v_exam uuid; v_has boolean;
begin
 if tg_table_name='exams' then
  v_exam:=old.id;
  if tg_op='UPDATE' and new.course_id<>old.course_id and exists(select 1 from public.subject_items i join public.course_subjects s on s.id=i.subject_id where i.exam_id=old.id and s.course_id<>new.course_id) then
   raise exception 'ITEM_COURSE_MISMATCH' using errcode='CF409';end if;
  if tg_op='UPDATE' and new.is_published and (not exists(select 1 from public.questions where exam_id=new.id) or exists(
   select 1 from public.questions q where q.exam_id=new.id and q.type='opcion_multiple' and
   (select count(*) from public.question_options o where o.question_id=q.id and o.is_correct)<>1)) then
   raise exception 'EXAM_INVALID_QUESTIONS' using errcode='CF409';end if;
 else
  if tg_op='UPDATE' then
   if tg_table_name='questions' then
    if new.exam_id<>old.exam_id then raise exception 'ITEM_IDENTITY_IMMUTABLE' using errcode='CF409';end if;
   elsif new.question_id<>old.question_id then raise exception 'ITEM_IDENTITY_IMMUTABLE' using errcode='CF409';end if;
  end if;
  if tg_table_name='questions' then v_exam:=case when tg_op='INSERT' then new.exam_id else old.exam_id end;
  else select exam_id into v_exam from public.questions where id=case when tg_op='INSERT' then new.question_id else old.question_id end;end if;
 end if;
 -- Comparte el lock del examen con el inicio: ni un cambio estructural puede ganar la carrera.
 perform 1 from public.exams where id=v_exam for update;
 select exists(select 1 from public.exam_attempts where exam_id=v_exam) into v_has;
 if v_has then
  if tg_table_name='exams' then
   if tg_op='DELETE' then raise exception 'EXAM_HAS_ATTEMPTS_UNPUBLISH' using errcode='CF409';end if;
   if (to_jsonb(new)-array['title','description','is_published','updated_at']) is distinct from
    (to_jsonb(old)-array['title','description','is_published','updated_at']) then raise exception 'EXAM_STRUCTURE_FROZEN' using errcode='CF409';end if;
  elsif tg_op<>'UPDATE' then raise exception 'EXAM_STRUCTURE_FROZEN' using errcode='CF409';
  elsif tg_table_name='questions' then
   if (to_jsonb(new)-'prompt') is distinct from (to_jsonb(old)-'prompt') then raise exception 'EXAM_STRUCTURE_FROZEN' using errcode='CF409';end if;
  elsif (to_jsonb(new)-'option_text') is distinct from (to_jsonb(old)-'option_text') then raise exception 'EXAM_STRUCTURE_FROZEN' using errcode='CF409';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $content_exam_guard_original$;
revoke all on function private.content_exam_guard() from public,anon,authenticated;
drop policy exam_question_images_backend_only on storage.objects;
delete from storage.buckets where id='exam-question-images';
drop index public.questions_image_path_unique;
alter table public.questions drop constraint questions_image_alt_length,drop constraint questions_image_path_format,drop constraint questions_image_alt_requires_path;
alter table public.questions drop column image_path,drop column image_alt;
notify pgrst,'reload schema';
commit;
select '067 revertida' as estado;
