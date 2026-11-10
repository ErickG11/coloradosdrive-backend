-- MANUAL, despues de 066b. No modifica 065/066 ni delete_student_data.
begin;
set local lock_timeout='5s';

alter table public.questions add column if not exists image_path text;
alter table public.questions add column if not exists image_alt text;
do $image_constraints$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.questions'::regclass and conname='questions_image_alt_length') then
  alter table public.questions add constraint questions_image_alt_length check(char_length(image_alt)<=300);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.questions'::regclass and conname='questions_image_path_format') then
  alter table public.questions add constraint questions_image_path_format check(image_path is null or
   image_path ~ ('^exams/'||exam_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.questions'::regclass and conname='questions_image_alt_requires_path') then
  alter table public.questions add constraint questions_image_alt_requires_path check(image_path is not null or image_alt is null);
 end if;
end $image_constraints$;
create unique index if not exists questions_image_path_unique on public.questions(image_path) where image_path is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('exam-question-images','exam-question-images',false,3145728,array['image/png','image/jpeg','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists exam_question_images_backend_only on storage.objects;
create policy exam_question_images_backend_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'exam-question-images') with check(bucket_id<>'exam-question-images');

do $guard_preflight$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.content_exam_guard()'::regprocedure)
 not in ('fd67e3841f8020078840f6c92fa6f3dd','c980f052e0ea3efccd45a4ac6e8cfa51') then raise exception '067: guard vigente distinto; revisar sin reemplazar';end if;
end $guard_preflight$;

create or replace function private.content_exam_guard() returns trigger language plpgsql security definer set search_path='' as $content_exam_guard$
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
   if (to_jsonb(new)-array['prompt','image_alt']) is distinct from (to_jsonb(old)-array['prompt','image_alt']) then raise exception 'EXAM_STRUCTURE_FROZEN' using errcode='CF409';end if;
  elsif (to_jsonb(new)-'option_text') is distinct from (to_jsonb(old)-'option_text') then raise exception 'EXAM_STRUCTURE_FROZEN' using errcode='CF409';end if;
 end if;
 if tg_table_name='questions' and tg_op='UPDATE' then
  if (new.image_path,new.image_alt) is distinct from (old.image_path,old.image_alt) and
   exists(select 1 from public.exams where id=v_exam and is_published) then
   raise exception 'EXAM_PUBLISHED_UNPUBLISH' using errcode='CF409';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $content_exam_guard$;

create or replace function private.exam_question_image(p_actor uuid,p_exam uuid,p_question uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $private_exam_question_image$
declare q public.questions; v_paths jsonb; v_published boolean; v_previous text; v_id uuid;
begin
 if not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then
  raise exception 'ADMIN_REQUIRED' using errcode='42501';
 end if;
 -- Mismo lock que iniciar intento/publicar. La captura y borrado del examen son atomicos.
 select is_published into v_published from public.exams where id=p_exam for update;
 if not found then raise exception 'ITEM_NOT_FOUND' using errcode='CF404';end if;
 if p_action='delete_exam' then
  select coalesce(jsonb_agg(image_path) filter(where image_path is not null),'[]') into v_paths from public.questions where exam_id=p_exam;
  delete from public.exams where id=p_exam returning id into v_id;
  return jsonb_build_object('paths',v_paths);
 end if;
 select * into q from public.questions where id=p_question and exam_id=p_exam for update;
 if not found then raise exception 'ITEM_NOT_FOUND' using errcode='CF404';end if;
 if p_action not in ('inspect','set','clear','alt') then raise exception 'INVALID_ACTION' using errcode='22023';end if;
 if p_action<>'alt' and exists(select 1 from public.exam_attempts where exam_id=p_exam) then
  raise exception 'EXAM_STRUCTURE_FROZEN' using errcode='CF409';end if;
 if v_published then raise exception 'EXAM_PUBLISHED_UNPUBLISH' using errcode='CF409';end if;
 v_previous:=q.image_path;
 if p_action in ('set','clear') then
  if not (p_data ? 'expected_path') or (p_data->>'expected_path') is distinct from q.image_path then
   raise exception 'IMAGE_CONFLICT' using errcode='CF409';end if;
 end if;
 if p_action in ('clear','alt') and q.image_path is null then raise exception 'IMAGE_NOT_FOUND' using errcode='CF404';end if;
 if p_action='set' then
  if p_data->>'path' is null then raise exception 'INVALID_CONTENT' using errcode='22023';end if;
  update public.questions set image_path=p_data->>'path',
   image_alt=case when p_data ? 'alt' then p_data->>'alt' else image_alt end where id=q.id returning * into q;
 elsif p_action='clear' then
  update public.questions set image_path=null,image_alt=null where id=q.id returning * into q;
 elsif p_action='alt' then
  if not (p_data ? 'alt') then raise exception 'INVALID_CONTENT' using errcode='22023';end if;
  update public.questions set image_alt=p_data->>'alt' where id=q.id returning * into q;
 end if;
 return jsonb_build_object('id',q.id,'exam_id',q.exam_id,'image_path',q.image_path,'image_alt',q.image_alt,'previous_path',v_previous);
end $private_exam_question_image$;
create or replace function public.exam_question_image(p_actor uuid,p_exam uuid,p_question uuid,p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $public_exam_question_image$
 select private.exam_question_image(p_actor,p_exam,p_question,p_action,p_data)
$public_exam_question_image$;
revoke all on function private.exam_question_image(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.exam_question_image(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.exam_question_image(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.exam_question_image(uuid,uuid,uuid,text,jsonb) to service_role;
-- Conservar el cierre de acceso al guard reemplazado, incluso con default grants.
revoke all on function private.content_exam_guard() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
select '067 completa' as estado;
