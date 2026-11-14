-- Fixtures exclusivos. Ejecutar ENTERO; ROLLBACK obligatorio.
begin;
set local lock_timeout='5s';
do $verify_067$ declare
 v_actor uuid:=gen_random_uuid(); v_student uuid:=gen_random_uuid(); v_course uuid:=gen_random_uuid();
 v_exam uuid:=gen_random_uuid(); v_q uuid:=gen_random_uuid(); v_cedula text; v_user uuid; v_result jsonb; v_path text; f regprocedure;
begin
 foreach v_user in array array[v_actor,v_student] loop
  insert into auth.users(id) values(v_user);
  loop v_cedula:=lpad(floor(random()*10000000000)::bigint::text,10,'0');exit when not exists(select 1 from public.users where cedula=v_cedula);end loop;
  insert into public.users(id,cedula,nombre_completo,rol,activo,debe_cambiar_password)
   values(v_user,v_cedula,'Fixture 067',case when v_user=v_actor then 'admin'::public.user_role else 'estudiante'::public.user_role end,true,false);
 end loop;
 insert into public.courses(id,nombre,tipo) values(v_course,'Fixture 067','A');
 insert into public.exams(id,course_id,title,type,time_limit_minutes,passing_score_percent) values(v_exam,v_course,'Fixture 067','practica',30,70);
 insert into public.questions(id,exam_id,type,prompt,order_index,points,correct_answer_text) values(v_q,v_exam,'texto_abierto','Fixture',0,1,'respuesta');
 v_path:='exams/'||v_exam||'/'||gen_random_uuid()||'.webp';
 v_result:=public.exam_question_image(v_actor,v_exam,v_q,'set',jsonb_build_object('expected_path',null,'path',v_path,'alt','Imagen de prueba'));
 if v_result->>'image_path' is distinct from v_path then raise exception '067: no guardo imagen';end if;
 begin
  update public.questions set image_alt=repeat('a',301) where id=v_q;
  raise exception '067: alt largo aceptado';
 exception when check_violation then null;end;
 begin
  update public.questions set image_path='../externo.svg' where id=v_q;
  raise exception '067: ruta invalida aceptada';
 exception when check_violation then null;end;
 begin
  perform public.exam_question_image(v_actor,v_exam,v_q,'set',jsonb_build_object('expected_path',null,'path',v_path));
  raise exception '067: CAS no protege reemplazo concurrente';
 exception when sqlstate 'CF409' then if sqlerrm<>'IMAGE_CONFLICT' then raise;end if;end;
 update public.exams set is_published=true where id=v_exam;
 begin
  perform public.exam_question_image(v_actor,v_exam,v_q,'alt','{"alt":"No permitido publicado"}');
  raise exception '067: imagen publicada editable';
 exception when sqlstate 'CF409' then if sqlerrm<>'EXAM_PUBLISHED_UNPUBLISH' then raise;end if;end;
 update public.exams set is_published=false where id=v_exam;
 insert into public.exam_attempts(exam_id,student_id,attempt_number,deadline_at,minutos_aplicados,max_attempts_aplicado)
  values(v_exam,v_student,1,now()+interval '30 minutes',30,null);
 update public.questions set prompt='Texto corregido',image_alt='Alt corregido' where id=v_q;
 if (select image_path from public.questions where id=v_q) is distinct from v_path then raise exception '067: guardar textos pierde imagen';end if;
 begin
  update public.questions set image_path=null,image_alt=null where id=v_q;
  raise exception '067: retiro imagen congelada';
 exception when sqlstate 'CF409' then if sqlerrm<>'EXAM_STRUCTURE_FROZEN' then raise;end if;end;
 begin
  update public.questions set image_path='exams/'||v_exam||'/'||gen_random_uuid()||'.png' where id=v_q;
  raise exception '067: cambio imagen congelada';
 exception when sqlstate 'CF409' then if sqlerrm<>'EXAM_STRUCTURE_FROZEN' then raise;end if;end;
 foreach f in array array['private.exam_question_image(uuid,uuid,uuid,text,jsonb)'::regprocedure,'public.exam_question_image(uuid,uuid,uuid,text,jsonb)'::regprocedure] loop
  if has_function_privilege('anon',f,'execute') or has_function_privilege('authenticated',f,'execute') or not has_function_privilege('service_role',f,'execute') then raise exception '067: ACL incorrecta %',f;end if;
  if not exists(select 1 from pg_proc where oid=f and proconfig @> array['search_path=""']) then raise exception '067: search_path incorrecto';end if;
 end loop;
 if (select prosecdef from pg_proc where oid='public.exam_question_image(uuid,uuid,uuid,text,jsonb)'::regprocedure) or
  not (select prosecdef from pg_proc where oid='private.exam_question_image(uuid,uuid,uuid,text,jsonb)'::regprocedure) then raise exception '067: SECURITY incorrecto';end if;
 if not exists(select 1 from storage.buckets where id='exam-question-images' and not public and file_size_limit=3145728 and allowed_mime_types @> array['image/png','image/jpeg','image/webp']) then raise exception '067: bucket incorrecto';end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='exam_question_images_backend_only' and permissive='RESTRICTIVE' and roles @> array['anon','authenticated']::name[]) then raise exception '067: falta politica restrictiva';end if;
end $verify_067$;
select '067 verificada (fixtures se revierten)' as estado;
rollback;
