-- F1.1: paso 066b MANUAL, despues de 066a completa y su preflight.
begin;
set local lock_timeout='5s';

-- Extension exacta de 060; mismo cuerpo esperado y controles vigentes.
do $extend_student_deletion$ declare v_body text;begin
 select prosrc into v_body from pg_proc where oid='public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure;
 if md5(replace(v_body,chr(13),''))<>'4cfb1f793a48d92124844e7acc9ac637' then raise exception '066: delete_student_data no coincide con la versión 060 revisada';end if;
 v_body:=replace(v_body,'  delete from public.exam_attempts where student_id=p_student;',
 '  delete from public.exam_attempts where student_id=p_student;'||chr(10)||
 '  delete from public.material_progress where student_id=p_student;'||chr(10)||
 '  delete from public.item_access_rules where target_type=''estudiante'' and student_id=p_student;');
 execute 'create or replace function public.delete_student_data(p_actor uuid,p_student uuid,p_version timestamptz,p_cleaned_paths text[]) returns jsonb language plpgsql security invoker set search_path='''' set lock_timeout=''5s'' as '||quote_literal(v_body);
end $extend_student_deletion$;


do $grant_content_api$ declare signature text; f regprocedure;begin
 foreach signature in array array['private.content_admin(uuid,text,jsonb)',
  'private.content_student(uuid,text,jsonb)',
  'private.finish_content_attempt(uuid,uuid,jsonb)',
  'private.content_attempt_state(uuid,uuid)',
  'public.content_attempt_state(uuid,uuid)',
  'public.content_admin(uuid,text,jsonb)',
  'public.content_student(uuid,text,jsonb)',
  'public.content_start_attempt(uuid,uuid)',
  'public.content_finish_attempt(uuid,uuid,jsonb)',
  'public.content_exam_access(uuid,uuid)'] loop
  f:=to_regprocedure(signature);
  if f is null then raise exception '066b: missing function %, apply complete 066a first',signature;end if;
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $grant_content_api$;
notify pgrst,'reload schema';
commit;
select '066b completa' as estado;
