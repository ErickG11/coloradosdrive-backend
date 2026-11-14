begin;
set local lock_timeout='5s';
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.content_student(uuid,text,jsonb)');if h is distinct from 'a47de72445a97353fd691e175faa5f30' then raise exception 'ROLLBACK_094: cuerpo desconocido: private.content_student(uuid,text,jsonb)';end if;end $guard$;
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.start_exam_attempt(uuid,uuid)');if h is distinct from '20253c5dfbcf538254bac79783d72a02' then raise exception 'ROLLBACK_094: cuerpo desconocido: private.start_exam_attempt(uuid,uuid)';end if;end $guard$;
CREATE OR REPLACE FUNCTION private.content_student(p_student uuid, p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_course uuid; v_item public.subject_items; v_subject public.course_subjects; v_material public.course_materials;
 v_access jsonb; v_result jsonb; v_subjects jsonb:='[]'; v_items jsonb; v_entry jsonb; v_continue jsonb; v_done boolean;
begin
 -- Finalizar ANTES de derivar estado, notas o progreso, incluso si se cerró la ventana.
 perform private.finalize_expired_content_attempts(p_student);
 if p_action='courses' then
  select coalesce(jsonb_agg(jsonb_build_object('course_id',c.id,'nombre',c.nombre,'tipo',c.tipo) order by c.nombre,c.id),'[]')
   into v_result from public.courses c where private.content_student_eligible(p_student,c.id);
  return v_result;
 end if;
 if p_action='catalog' then
  if p_data->>'course_id' is not null then v_course:=(p_data->>'course_id')::uuid;
  else
   select c.course_id into v_course from public.enrollments e join public.cohorts c on c.id=e.cohort_id
    where e.student_id=p_student and e.status='activo' and e.etapa_inscripcion='activa' order by e.created_at desc limit 1;
  end if;
  if v_course is null or not private.content_student_eligible(p_student,v_course) then return jsonb_build_object('error','ITEM_NOT_FOUND');end if;
  for v_subject in select * from public.course_subjects where course_id=v_course and is_published order by order_index,id loop
   v_items:='[]';
   for v_item in select i.* from public.subject_items i where subject_id=v_subject.id and
    ((kind='material' and exists(select 1 from public.course_materials where id=i.material_id and is_published)) or
    (kind='examen' and exists(select 1 from public.exams where id=i.exam_id and is_published))) order by order_index,id loop
    v_access:=private.resolve_item_access(p_student,v_item.id);
    if v_item.kind='material' then
     select jsonb_build_object('title',m.title,'description',m.description,'material_kind',m.kind) into v_entry from public.course_materials m where id=v_item.material_id;
     select exists(select 1 from public.material_progress where student_id=p_student and material_id=v_item.material_id and completed_at is not null) into v_done;
    else
     select jsonb_build_object('title',e.title,'description',e.description,'intentos_usados',(select count(*) from public.exam_attempts where student_id=p_student and exam_id=e.id),
     'intentos_permitidos',v_access->'max_attempts','mejor_nota',(select max(score_percent) from public.exam_attempts where student_id=p_student and exam_id=e.id),
     'intento_en_progreso',(select jsonb_build_object('id',a.id,'deadline_at',a.deadline_at) from public.exam_attempts a where a.student_id=p_student and a.exam_id=e.id and a.status='en_progreso')) into v_entry from public.exams e where id=v_item.exam_id;
     select exists(select 1 from public.exam_attempts where student_id=p_student and exam_id=v_item.exam_id and status='completado' and passed) into v_done;
    end if;
    v_entry:=v_entry||to_jsonb(v_item)||jsonb_build_object('access',v_access,'completado',v_done);
    v_items:=v_items||jsonb_build_array(v_entry);
    if v_continue is null and v_item.obligatorio and not v_done and v_access->>'estado'='abierto' then v_continue:=jsonb_build_object('subject_id',v_subject.id,'item_id',v_item.id);end if;
   end loop;
   v_subjects:=v_subjects||jsonb_build_array(to_jsonb(v_subject)||jsonb_build_object('items',v_items));
  end loop;
  return jsonb_build_object('course_id',v_course,'materias',v_subjects,'progreso',private.student_course_progress(p_student,v_course),'continuar',v_continue,'server_now',now());
 end if;
 select * into v_item from public.subject_items where id=(p_data->>'item_id')::uuid;
 select * into v_subject from public.course_subjects where id=v_item.subject_id;
 select * into v_material from public.course_materials where id=v_item.material_id;
 if v_item.id is null or v_item.kind<>'material' or not v_subject.is_published or not v_material.is_published or
 not private.content_student_eligible(p_student,v_subject.course_id) then return jsonb_build_object('error','ITEM_NOT_FOUND');end if;
 v_access:=private.resolve_item_access(p_student,v_item.id);
 if v_access->>'estado'<>'abierto' then return jsonb_build_object('error',case v_access->>'estado' when 'programado' then 'ITEM_PROGRAMADO' when 'cerrado' then 'ITEM_CERRADO' else 'ITEM_NO_HABILITADO' end);end if;
 if p_action not in ('open','complete') then raise exception 'INVALID_ACTION' using errcode='22023';end if;
 insert into public.material_progress(student_id,material_id,completed_at) values(p_student,v_material.id,
  case when p_action='complete' and (p_data->>'completed')::boolean then now() end)
 on conflict(student_id,material_id) do update set completed_at=case when p_action='open' then material_progress.completed_at when (p_data->>'completed')::boolean then coalesce(material_progress.completed_at,now()) else null end;
 if p_action='complete' then return jsonb_build_object('completed',(p_data->>'completed')::boolean);end if;
 return jsonb_build_object('kind',v_material.kind,'title',v_material.title,'storage_path',v_material.storage_path,'url',v_material.url,'body',v_material.body);
end $function$
;

CREATE OR REPLACE FUNCTION private.start_exam_attempt(p_student uuid, p_exam uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.exams; a public.exam_attempts; i public.subject_items; s public.course_subjects; access jsonb; v_used integer; v_max integer; v_minutes integer; v_expired jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_student::text||':'||p_exam::text,0));
 select * into e from public.exams where id=p_exam for update;
 select * into i from public.subject_items where exam_id=p_exam;
 select * into s from public.course_subjects where id=i.subject_id;
 if i.id is null or not private.content_student_eligible(p_student,s.course_id) then return jsonb_build_object('error','ITEM_NOT_FOUND');end if;
 v_expired:=private.finalize_expired_content_attempts(p_student);
 if not s.is_published then return jsonb_build_object('error','ITEM_NOT_FOUND','_expired_attempts',v_expired);end if;
 if not e.is_published then return jsonb_build_object('error','EXAM_NOT_PUBLISHED','_expired_attempts',v_expired);end if;
 select * into a from public.exam_attempts where student_id=p_student and exam_id=p_exam and status='en_progreso';
 -- Una regla revocada/editada no cambia un intento adquirido.
 if a.id is not null then return to_jsonb(a)||jsonb_build_object('_expired_attempts',v_expired);end if;
 if e.type='definitivo' and exists(select 1 from public.exam_attempts where student_id=p_student and exam_id=p_exam and status='completado' and passed) then
  return jsonb_build_object('error','ALREADY_PASSED','_expired_attempts',v_expired);end if;
 access:=private.resolve_item_access(p_student,i.id);
 if access->>'estado'<>'abierto' then return jsonb_build_object('error',case access->>'estado' when 'programado' then 'ITEM_PROGRAMADO' when 'cerrado' then 'ITEM_CERRADO' else 'ITEM_NO_HABILITADO' end,'_expired_attempts',v_expired);end if;
 v_max:=(access->>'max_attempts')::integer;
 select count(*) into v_used from public.exam_attempts where student_id=p_student and exam_id=p_exam;
 if v_max is not null and v_used>=v_max then return jsonb_build_object('error','ATTEMPTS_EXHAUSTED','_expired_attempts',v_expired);end if;
 v_minutes:=e.time_limit_minutes+(access->>'extra_minutes')::integer;
 insert into public.exam_attempts(exam_id,student_id,attempt_number,deadline_at,max_attempts_aplicado,minutos_aplicados)
 values(p_exam,p_student,v_used+1,least(now()+make_interval(mins=>v_minutes),(access->>'closes_at')::timestamptz),v_max,v_minutes) returning * into a;
 return to_jsonb(a)||jsonb_build_object('_expired_attempts',v_expired);
end $function$
;

drop function private.exam_prerequisites_v20(uuid,uuid);
notify pgrst, 'reload schema';
commit;
