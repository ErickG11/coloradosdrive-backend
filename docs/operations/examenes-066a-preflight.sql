-- SOLO LECTURA. Después de 065, antes de 066a. Base remota: ejecución manual de Erick.
begin read only;
select count(*) progreso_actual from public.material_progress;
select target_type,count(*) from public.item_access_rules group by target_type;
select count(*) intentos_sin_deadline from public.exam_attempts where deadline_at is null or attempt_number is null;
select md5(replace(prosrc,chr(13),'')) delete_student_data_hash from pg_proc
 where oid=to_regprocedure('public.delete_student_data(uuid,uuid,timestamptz,text[])');
do $preflight_066a$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.delete_student_data(uuid,uuid,timestamptz,text[])')) is distinct from '4cfb1f793a48d92124844e7acc9ac637' then
 raise exception '066: el cuerpo de borrado vigente difiere de 060; revisar sin reemplazarlo';end if;
 if to_regprocedure('private.resolve_item_access(uuid,uuid)') is null or to_regprocedure('private.start_exam_attempt(uuid,uuid)') is null
 or to_regprocedure('private.student_course_progress(uuid,uuid)') is null then raise exception '066: falta 065';end if;
 if exists(select 1 from unnest(array['private.content_admin(uuid,text,jsonb)',
  'private.content_student(uuid,text,jsonb)',
  'private.finish_content_attempt(uuid,uuid,jsonb)',
  'private.content_attempt_state(uuid,uuid)',
  'public.content_attempt_state(uuid,uuid)',
  'public.content_admin(uuid,text,jsonb)',
  'public.content_student(uuid,text,jsonb)',
  'public.content_start_attempt(uuid,uuid)',
  'public.content_finish_attempt(uuid,uuid,jsonb)',
  'public.content_exam_access(uuid,uuid)']) signature where to_regprocedure(signature) is not null) then raise exception '066a: funciones ya existentes; revisar estado antes de repetir';end if;
end $preflight_066a$;
rollback;
