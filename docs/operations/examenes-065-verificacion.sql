-- Solo datos de prueba nuevos; sin cambiar roles ni datos reales. Ejecutar entero.
begin;
do $$ declare t text;f regprocedure;v_count integer;begin
 foreach t in array array['course_subjects','course_materials','subject_items','item_access_rules','material_progress','content_access_audit'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS apagada: %',t;end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename=t) then raise exception 'Políticas inesperadas: %',t;end if;
  if has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'ACL pública: %',t;end if;
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and
 p.proname in ('content_student_eligible','resolve_item_access','start_exam_attempt','student_course_progress','finalize_expired_content_attempts','content_consistency','content_exam_guard','content_attempt_immutable') loop
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'EXECUTE público: %',f;end if;
 end loop;
 if not exists(select 1 from storage.buckets where id='course-content' and not public and file_size_limit=10485760) then raise exception 'Bucket incorrecto';end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='course_content_backend_only' and permissive='RESTRICTIVE') then raise exception 'Falta protección de Storage';end if;
 if exists(select 1 from public.exam_attempts where deadline_at is null or attempt_number is null) then raise exception 'Backfill incompleto';end if;
 if not exists(select 1 from pg_index where indexrelid='public.exam_attempts_one_in_progress'::regclass and indisunique and indpred is not null) then raise exception 'Falta índice parcial';end if;
 select count(*) into v_count from public.exams e where not exists(select 1 from public.subject_items where exam_id=e.id);
 if v_count<>0 then raise exception 'Exámenes existentes sin item: %',v_count;end if;
end $$;
select course_id,title,is_published from public.course_subjects order by course_id,order_index;
rollback;
