-- Fixtures nuevos, limpieza definitiva por el mismo protocolo CAS de 026/060.
-- Toda la verificación termina en ROLLBACK; no usar alumnos reales.
begin;
create temp table content_fixture(actor uuid,student uuid,course uuid,cohort uuid,subject uuid,material uuid,item uuid) on commit drop;
insert into content_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
do $$ declare f content_fixture;u uuid;v_cedula text;begin
 select * into f from content_fixture;
 foreach u in array array[f.actor,f.student] loop
  insert into auth.users(id) values(u);
  loop v_cedula:=lpad(floor(random()*10000000000)::bigint::text,10,'0');exit when not exists(select 1 from public.users where cedula=v_cedula);end loop;
  insert into public.users(id,cedula,nombre_completo,rol,activo,debe_cambiar_password) values(u,v_cedula,'Fixture Contenido',case when u=f.actor then 'admin'::public.user_role else 'estudiante'::public.user_role end,true,false);
 end loop;
 insert into public.courses(id,nombre,tipo) values(f.course,'Fixture Contenido','A');
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
 values(f.cohort,f.course,'Fixture Contenido',100,10,current_date,current_date+10,current_date+11,current_date+60);
 insert into public.enrollments(student_id,cohort_id,course_id,status,monto_total) values(f.student,f.cohort,f.course,'activo',100);
 insert into public.course_subjects(id,course_id,title,is_published) values(f.subject,f.course,'Fixture',true);
 insert into public.course_materials(id,title,kind,body,is_published) values(f.material,'Fixture','texto','Texto plano',true);
 insert into public.subject_items(id,subject_id,kind,material_id) values(f.item,f.subject,'material',f.material);
end $$;
grant select on content_fixture to service_role;
set local role service_role;
do $$ declare f content_fixture;r jsonb;op jsonb;v_cedula text;v_count bigint;begin
 select * into f from content_fixture;
 r:=public.content_admin(f.actor,'rules.set',jsonb_build_object('scope','item','scope_id',f.item,'target_type','estudiante','target_id',f.student));
 if r->>'changed'<>'1' then raise exception 'No habilitó';end if;
 r:=public.content_admin(f.actor,'rules.set',jsonb_build_object('scope','item','scope_id',f.item,'target_type','estudiante','target_id',f.student));
 if r->>'changed'<>'0' then raise exception 'No idempotente';end if;
 if (select count(*) from public.notifications where user_id=f.student)<>1 then raise exception 'Duplicó notificación';end if;
 r:=public.content_student(f.student,'complete',jsonb_build_object('item_id',f.item,'completed',true));
 r:=private.student_course_progress(f.student,f.course);
 if not (r->>'certificado_listo')::boolean or (r->>'global')::numeric<>100 then raise exception 'Progreso incorrecto';end if;
 select cedula into v_cedula from public.users where id=f.student;
 op:=public.begin_student_deletion(f.actor,f.student,v_cedula);
 op:=public.advance_student_deletion(f.actor,f.student,op->>'phase',(op->>'updated_at')::timestamptz,'storage');
 -- Versión antigua: no debe borrar nada.
 perform public.delete_student_data(f.actor,f.student,(op->>'updated_at')::timestamptz-interval '1 second','{}');
 if not exists(select 1 from public.material_progress where student_id=f.student) then raise exception 'CAS no conservado';end if;
 op:=public.delete_student_data(f.actor,f.student,(op->>'updated_at')::timestamptz,'{}');
 if op->>'phase'<>'auth' then raise exception 'No avanzó a Auth';end if;
 select (select count(*) from public.users where id=f.student)+(select count(*) from public.material_progress where student_id=f.student)+
 (select count(*) from public.item_access_rules where student_id=f.student)+(select count(*) from public.enrollments where student_id=f.student)+
 (select count(*) from public.exam_attempts where student_id=f.student)+(select count(*) from public.notifications where user_id=f.student) into v_count;
 if v_count<>0 then raise exception 'Borrado dejó restos: %',v_count;end if;
 if not exists(select 1 from public.content_access_audit where target_id=f.student) then raise exception 'Auditoría perdida';end if;
end $$;
reset role;
do $verify_permissions_066b$ declare f regprocedure; signature text;begin
 foreach signature in array array[
  'private.content_admin(uuid,text,jsonb)','private.content_student(uuid,text,jsonb)',
  'private.finish_content_attempt(uuid,uuid,jsonb)','private.content_attempt_state(uuid,uuid)',
  'public.content_admin(uuid,text,jsonb)','public.content_student(uuid,text,jsonb)',
  'public.content_start_attempt(uuid,uuid)','public.content_finish_attempt(uuid,uuid,jsonb)',
  'public.content_exam_access(uuid,uuid)','public.content_attempt_state(uuid,uuid)'] loop
  f:=to_regprocedure(signature);
  if f is null then raise exception '066b: falta funcion %',signature;end if;
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'ACL pública: %',f;end if;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception '066b: falta EXECUTE service_role: %',f;end if;
 end loop;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure) is distinct from 'd8ce262575d1e5b76d78d7d01441c909' then raise exception '066b: cuerpo de borrado final distinto';end if;
end $verify_permissions_066b$;
rollback;
