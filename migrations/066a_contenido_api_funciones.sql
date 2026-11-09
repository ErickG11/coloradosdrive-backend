-- F1.1: paso 066a MANUAL, sobre 065 YA aplicada. No volver a aplicar 065.
begin;
set local lock_timeout='5s';

create function private.content_admin(p_actor uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $private_content_admin$
declare v_id uuid:=(p_data->>'id')::uuid; v_course uuid; v_subject uuid; v_item public.subject_items;
 v_s public.course_subjects; v_m public.course_materials; v_r public.item_access_rules; v_new public.item_access_rules;
 v_target uuid; v_target_type text; v_changed boolean:=false; v_extra boolean:=false; v_item_extra boolean; v_snapshot jsonb; v_before_access jsonb;
 v_result jsonb; v_entries jsonb:='[]'; v_entry jsonb; v_student record; v_i integer:=0; v_type text; v_day date;
 v_scope_title text; v_scope_kind text; v_message text; v_extra_titles text[]:='{}';
begin
 if not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then
  raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 case p_action
 when 'subjects.list' then
  select coalesce(jsonb_agg(to_jsonb(s) order by order_index,id),'[]') into v_result from public.course_subjects s where course_id=(p_data->>'course_id')::uuid;
 when 'subjects.save' then
  if v_id is null then
   insert into public.course_subjects(course_id,title,description,order_index,is_published)
    values((p_data->>'course_id')::uuid,p_data->>'title',p_data->>'description',coalesce((p_data->>'order_index')::integer,0),coalesce((p_data->>'is_published')::boolean,false)) returning * into v_s;
  else
   select * into v_s from public.course_subjects where id=v_id for update;
   if not found then raise exception 'ITEM_NOT_FOUND' using errcode='CF404';end if;
   v_s:=jsonb_populate_record(v_s,p_data-array['id','course_id','created_at','updated_at']);
   update public.course_subjects set title=v_s.title,description=v_s.description,order_index=v_s.order_index,is_published=v_s.is_published,updated_at=now() where id=v_id returning * into v_s;
  end if;
  v_result:=to_jsonb(v_s);
 when 'subjects.delete' then
  if exists(select 1 from public.subject_items where subject_id=v_id) then raise exception 'SUBJECT_HAS_ITEMS_UNPUBLISH' using errcode='CF409';end if;
  delete from public.course_subjects where id=v_id returning to_jsonb(course_subjects) into v_result;
 when 'subjects.reorder' then
  v_course:=(p_data->>'course_id')::uuid;
  perform 1 from public.courses where id=v_course for update;
  if jsonb_array_length(p_data->'ids')<>(select count(*) from public.course_subjects where course_id=v_course)
   or (select count(distinct value) from jsonb_array_elements_text(p_data->'ids'))<>jsonb_array_length(p_data->'ids') then raise exception 'INVALID_ORDER' using errcode='CF409';end if;
  for v_entry in select value from jsonb_array_elements(p_data->'ids') loop
   update public.course_subjects set order_index=v_i,updated_at=now() where id=(v_entry#>>'{}')::uuid and course_id=v_course;
   if not found then raise exception 'INVALID_ORDER' using errcode='CF409';end if;v_i:=v_i+1;
  end loop;v_result:=jsonb_build_object('updated',v_i);
 when 'materials.list' then
  select coalesce(jsonb_agg(to_jsonb(m) order by created_at,id),'[]') into v_result from public.course_materials m;
 when 'materials.save' then
  if v_id is null then
   insert into public.course_materials(title,description,kind,storage_path,mime_type,size_bytes,url,body,is_published,created_by)
   values(p_data->>'title',p_data->>'description',p_data->>'kind',p_data->>'storage_path',p_data->>'mime_type',
   (p_data->>'size_bytes')::integer,p_data->>'url',p_data->>'body',coalesce((p_data->>'is_published')::boolean,false),p_actor) returning * into v_m;
  else
   select * into v_m from public.course_materials where id=v_id for update;
   if not found then raise exception 'ITEM_NOT_FOUND' using errcode='CF404';end if;
   v_m:=jsonb_populate_record(v_m,p_data-array['id','kind','storage_path','mime_type','size_bytes','created_by','created_at','updated_at']);
   update public.course_materials set title=v_m.title,description=v_m.description,url=v_m.url,body=v_m.body,is_published=v_m.is_published,updated_at=now() where id=v_id returning * into v_m;
  end if;v_result:=to_jsonb(v_m);
 when 'materials.delete' then
  -- Los archivos se conservan: evitar borrar en Storage antes de confirmar el DELETE.
  delete from public.course_materials where id=v_id returning to_jsonb(course_materials) into v_result;
 when 'items.list' then
  select coalesce(jsonb_agg(to_jsonb(i) order by order_index,id),'[]') into v_result from public.subject_items i where subject_id=(p_data->>'subject_id')::uuid;
 when 'items.save' then
  if v_id is null then
   insert into public.subject_items(subject_id,kind,material_id,exam_id,order_index,obligatorio) values
   ((p_data->>'subject_id')::uuid,p_data->>'kind',(p_data->>'material_id')::uuid,(p_data->>'exam_id')::uuid,
   coalesce((p_data->>'order_index')::integer,0),coalesce((p_data->>'obligatorio')::boolean,true)) returning * into v_item;
  else
   select * into v_item from public.subject_items where id=v_id for update;
   if not found then raise exception 'ITEM_NOT_FOUND' using errcode='CF404';end if;
   update public.subject_items set subject_id=coalesce((p_data->>'subject_id')::uuid,subject_id),
   order_index=coalesce((p_data->>'order_index')::integer,order_index),obligatorio=coalesce((p_data->>'obligatorio')::boolean,obligatorio)
   where id=v_id returning * into v_item;
  end if;v_result:=to_jsonb(v_item);
 when 'items.delete' then
  select * into v_item from public.subject_items where id=v_id for update;
  if exists(select 1 from public.material_progress where material_id=v_item.material_id) or exists(select 1 from public.exam_attempts where exam_id=v_item.exam_id) then
   raise exception 'ITEM_HAS_PROGRESS_UNPUBLISH' using errcode='CF409';end if;
  delete from public.subject_items where id=v_id returning to_jsonb(subject_items) into v_result;
 when 'items.reorder' then
  v_subject:=(p_data->>'subject_id')::uuid;
  perform 1 from public.course_subjects where id=v_subject for update;
  if jsonb_array_length(p_data->'ids')<>(select count(*) from public.subject_items where subject_id=v_subject)
   or (select count(distinct value) from jsonb_array_elements_text(p_data->'ids'))<>jsonb_array_length(p_data->'ids') then raise exception 'INVALID_ORDER' using errcode='CF409';end if;
  for v_entry in select value from jsonb_array_elements(p_data->'ids') loop
   update public.subject_items set order_index=v_i where id=(v_entry#>>'{}')::uuid and subject_id=v_subject;
   if not found then raise exception 'INVALID_ORDER' using errcode='CF409';end if;v_i:=v_i+1;
  end loop;v_result:=jsonb_build_object('updated',v_i);
 when 'rules.list' then
  select coalesce(jsonb_agg(to_jsonb(r) order by created_at,id),'[]') into v_result from public.item_access_rules r where item_id=(p_data->>'item_id')::uuid;
 when 'rules.set' then
  v_target:=(p_data->>'target_id')::uuid;v_target_type:=p_data->>'target_type';
  if v_target_type not in ('cohorte','estudiante') or p_data->>'scope' not in ('item','materia','curso') then raise exception 'INVALID_SCOPE' using errcode='22023';end if;
  if p_data->>'scope'='curso' then v_course:=(p_data->>'scope_id')::uuid;
  elsif p_data->>'scope'='materia' then select course_id into v_course from public.course_subjects where id=(p_data->>'scope_id')::uuid;
  else select s.course_id into v_course from public.subject_items i join public.course_subjects s on s.id=i.subject_id where i.id=(p_data->>'scope_id')::uuid;end if;
  perform 1 from public.courses where id=v_course for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='CF404';end if;
  if p_data->>'scope'='curso' then
   select left(nombre,120) into v_scope_title from public.courses where id=v_course;
  elsif p_data->>'scope'='materia' then
   select left(title,120) into v_scope_title from public.course_subjects where id=(p_data->>'scope_id')::uuid;
  else
   select left(case when i.kind='examen' then e.title else m.title end,120),i.kind into v_scope_title,v_scope_kind
    from public.subject_items i left join public.exams e on e.id=i.exam_id left join public.course_materials m on m.id=i.material_id
    where i.id=(p_data->>'scope_id')::uuid;
  end if;
  for v_item in select i.* from public.subject_items i join public.course_subjects s on s.id=i.subject_id
   where s.course_id=v_course and (p_data->>'scope'='curso' or (p_data->>'scope'='materia' and s.id=(p_data->>'scope_id')::uuid)
   or (p_data->>'scope'='item' and i.id=(p_data->>'scope_id')::uuid)) order by i.id loop
   select * into v_r from public.item_access_rules where item_id=v_item.id and target_type=v_target_type and coalesce(cohort_id,student_id)=v_target for update;
   if v_item.kind='material' and p_data->>'scope'='item' and (p_data->>'max_attempts' is not null or coalesce((p_data->>'extra_minutes')::integer,0)<>0) then
    raise exception 'EXAM_RULE_ONLY' using errcode='CF409';end if;
   v_new:=v_r;
   v_new.habilitado:=coalesce((p_data->>'habilitado')::boolean,true);
   v_new.opens_at:=(p_data->>'opens_at')::timestamptz;v_new.closes_at:=(p_data->>'closes_at')::timestamptz;
   v_new.max_attempts:=case when v_item.kind='examen' then (p_data->>'max_attempts')::integer else null end;
   v_new.extra_minutes:=case when v_item.kind='examen' then coalesce((p_data->>'extra_minutes')::integer,0) else 0 end;
   v_new.note:=p_data->>'note';
   -- Comparar también note, pero no almacenar texto libre en auditoría.
   if v_r.id is not null and (v_r.habilitado,v_r.opens_at,v_r.closes_at,v_r.max_attempts,v_r.extra_minutes,v_r.note) is not distinct from
    (v_new.habilitado,v_new.opens_at,v_new.closes_at,v_new.max_attempts,v_new.extra_minutes,v_new.note) then continue;end if;
   v_item_extra:=false;
   v_before_access:=private.resolve_item_access(v_target,v_item.id);
   if v_target_type='estudiante' and v_item.kind='examen' and
    (v_new.extra_minutes>coalesce((v_before_access->>'extra_minutes')::integer,0) or coalesce(v_new.max_attempts,(select max_attempts_default from public.exams where id=v_item.exam_id),2147483647)>
    coalesce((v_before_access->>'max_attempts')::integer,2147483647)) then v_extra:=true;v_item_extra:=true;end if;
   v_snapshot:=jsonb_build_object('antes',case when v_r.id is null then null else jsonb_build_object('opens_at',v_r.opens_at,'closes_at',v_r.closes_at,'max_attempts',v_r.max_attempts,'extra_minutes',v_r.extra_minutes,'habilitado',v_r.habilitado) end,
   'despues',jsonb_build_object('opens_at',v_new.opens_at,'closes_at',v_new.closes_at,'max_attempts',v_new.max_attempts,'extra_minutes',v_new.extra_minutes,'habilitado',v_new.habilitado));
   insert into public.item_access_rules(item_id,target_type,cohort_id,student_id,habilitado,opens_at,closes_at,max_attempts,extra_minutes,note,created_by)
   values(v_item.id,v_target_type,case when v_target_type='cohorte' then v_target end,case when v_target_type='estudiante' then v_target end,
    v_new.habilitado,v_new.opens_at,v_new.closes_at,v_new.max_attempts,v_new.extra_minutes,v_new.note,p_actor)
   on conflict(item_id,target_type,(coalesce(cohort_id,student_id))) do update set habilitado=excluded.habilitado,opens_at=excluded.opens_at,
    closes_at=excluded.closes_at,max_attempts=excluded.max_attempts,extra_minutes=excluded.extra_minutes,note=excluded.note,updated_at=now();
   insert into public.content_access_audit(actor_id,action,item_id,target_type,target_id,snapshot)
   values(p_actor,case when not v_new.habilitado then 'revocar' when v_r.id is null then 'crear' else 'editar' end,v_item.id,v_target_type,v_target,v_snapshot);
   if v_item_extra then insert into public.content_access_audit(actor_id,action,item_id,target_type,target_id,snapshot)
    values(p_actor,'intento_extra',v_item.id,v_target_type,v_target,v_snapshot);
    v_extra_titles:=array_append(v_extra_titles,(select left(title,120) from public.exams where id=v_item.exam_id));end if;
   v_changed:=true;v_i:=v_i+1;
  end loop;
  if v_changed then
   v_type:=case when p_data->>'scope'='item' and v_scope_kind='examen' then 'examen_habilitado' else 'contenido_habilitado' end;
   v_message:=case when coalesce((p_data->>'habilitado')::boolean,true) then 'Se habilitó ' else 'Se bloqueó ' end ||
    case p_data->>'scope' when 'materia' then 'la materia ' when 'curso' then 'contenido del curso ' else '' end ||'«'||v_scope_title||'».' ||
    case when (p_data->>'opens_at')::timestamptz>now() then ' Apertura: '||to_char((p_data->>'opens_at')::timestamptz at time zone 'America/Guayaquil','YYYY-MM-DD HH24:MI')||' (America/Guayaquil).' else '' end ||
    case when p_data->>'closes_at' is not null then ' Cierra: '||to_char((p_data->>'closes_at')::timestamptz at time zone 'America/Guayaquil','YYYY-MM-DD HH24:MI')||' (America/Guayaquil).' else '' end;
   for v_student in select distinct u.id from public.users u join public.enrollments e on e.student_id=u.id join public.cohorts c on c.id=e.cohort_id
    where u.rol='estudiante' and u.activo and e.status='activo' and e.etapa_inscripcion='activa' and c.course_id=v_course
    and ((v_target_type='estudiante' and u.id=v_target) or (v_target_type='cohorte' and e.cohort_id=v_target)) loop
    insert into public.notifications(user_id,tipo,titulo,mensaje,email_status)
    values(v_student.id,v_type,'Contenido actualizado',v_message,null);
    if v_extra and v_target_type='estudiante' then
     insert into public.notifications(user_id,tipo,titulo,mensaje,email_status) values(v_student.id,'intento_extra','Ampliación de examen',
      'Se ampliaron tus intentos o minutos para '||(select string_agg('«'||title||'»',', ' order by title) from (select distinct unnest(v_extra_titles) title) titles)||'.',null);
    end if;
   end loop;
  end if;v_result:=jsonb_build_object('changed',v_i);
 when 'progress.student' then
  v_result:=private.student_course_progress((p_data->>'student_id')::uuid,(p_data->>'course_id')::uuid);
 when 'progress.cohort' then
  select course_id into v_course from public.cohorts where id=(p_data->>'cohort_id')::uuid;
  if v_course is null then raise exception 'ITEM_NOT_FOUND' using errcode='CF404';end if;
  for v_student in select distinct u.id,u.nombre_completo from public.users u join public.enrollments e on e.student_id=u.id
   where e.cohort_id=(p_data->>'cohort_id')::uuid and e.status='activo' loop
   v_entry:=private.student_course_progress(v_student.id,v_course);
   v_entries:=v_entries||jsonb_build_array(jsonb_build_object('student_id',v_student.id,'nombre_completo',v_student.nombre_completo,'global',v_entry->'global','completa',v_entry->'completa'));
  end loop;
  select jsonb_build_object('students',v_entries,'promedio_global',coalesce(round(avg((x->>'global')::numeric),2),0),'rangos',
   jsonb_build_object('0-25',count(*) filter(where (x->>'global')::numeric<=25),'26-50',count(*) filter(where (x->>'global')::numeric>25 and (x->>'global')::numeric<=50),
   '51-75',count(*) filter(where (x->>'global')::numeric>50 and (x->>'global')::numeric<=75),'76-99',count(*) filter(where (x->>'global')::numeric>75 and not (x->>'completa')::boolean),
   '100',count(*) filter(where (x->>'completa')::boolean))) into v_result from jsonb_array_elements(v_entries) x;
 when 'results' then
  perform private.finalize_expired_content_attempts(null,(p_data->>'exam_id')::uuid);
  for v_student in select distinct a.student_id from public.exam_attempts a where a.exam_id=(p_data->>'exam_id')::uuid and
   (p_data->>'cohort_id' is null or exists(select 1 from public.enrollments where student_id=a.student_id and cohort_id=(p_data->>'cohort_id')::uuid)) loop
   select jsonb_build_object('student_id',v_student.student_id,'mejor_nota',max(score_percent),'intentos_usados',count(*),
   'intentos_permitidos',(private.resolve_item_access(v_student.student_id,(select id from public.subject_items where exam_id=(p_data->>'exam_id')::uuid)))->'max_attempts',
   'intentos',jsonb_agg(to_jsonb(a) order by attempt_number)) into v_entry from public.exam_attempts a where student_id=v_student.student_id and exam_id=(p_data->>'exam_id')::uuid;
   v_entries:=v_entries||jsonb_build_array(v_entry);
  end loop;v_result:=v_entries;
 when 'upload.reserve' then
  v_day:=(now() at time zone 'America/Guayaquil')::date;
  insert into private.content_upload_limits(admin_id,day,used) values(p_actor,v_day,1)
   on conflict(admin_id,day) do update set used=content_upload_limits.used+1 where content_upload_limits.used<50 returning used into v_i;
  if not found then raise exception 'UPLOAD_DAILY_LIMIT' using errcode='CF429';end if;
  v_result:=jsonb_build_object('used',v_i,'limit',50);
 else raise exception 'INVALID_ACTION' using errcode='22023';
 end case;
 if v_result is null then raise exception 'ITEM_NOT_FOUND' using errcode='CF404';end if;
 return v_result;
end $private_content_admin$;

create function private.content_student(p_student uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $private_content_student$
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
end $private_content_student$;

create function private.finish_content_attempt(p_student uuid,p_attempt uuid,p_answers jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $private_finish_content_attempt$
declare a public.exam_attempts; e public.exams; v_total numeric; v_earned numeric; v_score numeric; v_expired jsonb;
begin
 select * into a from public.exam_attempts where id=p_attempt and student_id=p_student for update;
 if not found then return jsonb_build_object('error','ITEM_NOT_FOUND');end if;
 select * into e from public.exams where id=a.exam_id;
 if not private.content_student_eligible(p_student,e.course_id) or not e.is_published or not exists(
  select 1 from public.subject_items i join public.course_subjects s on s.id=i.subject_id where i.exam_id=e.id and s.is_published) then return jsonb_build_object('error','ITEM_NOT_FOUND');end if;
 if a.status='completado' then return jsonb_build_object('error','ATTEMPT_COMPLETED');end if;
 if a.deadline_at<now() then v_expired:=private.finalize_expired_content_attempts(p_student,a.exam_id);return jsonb_build_object('error','ATTEMPT_EXPIRED','_expired_attempts',v_expired);end if;
 -- p_answers es producido exclusivamente por el calificador del backend, jamás desde HTTP directamente.
 insert into public.attempt_answers(attempt_id,question_id,selected_option_id,text_answer,is_correct,similarity_score)
 select a.id,x.question_id,x.selected_option_id,x.text_answer,x.is_correct,x.similarity_score
 from jsonb_to_recordset(p_answers) x(question_id uuid,selected_option_id uuid,text_answer text,is_correct boolean,similarity_score numeric)
 join public.questions q on q.id=x.question_id and q.exam_id=e.id;
 select coalesce(sum(points),0) into v_total from public.questions where exam_id=e.id;
 select coalesce(sum(q.points),0) into v_earned from public.attempt_answers x join public.questions q on q.id=x.question_id where x.attempt_id=a.id and x.is_correct;
 v_score:=case when v_total>0 then v_earned/v_total*100 else 0 end;
 update public.exam_attempts set status='completado',score_percent=v_score,passed=v_score>=e.passing_score_percent,completed_at=now() where id=a.id returning * into a;
 return to_jsonb(a);
end $private_finish_content_attempt$;

-- Entradas de PostgREST SECURITY INVOKER; el código privilegiado permanece en private.
create function private.content_attempt_state(p_student uuid,p_attempt uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $private_content_attempt_state$
declare a public.exam_attempts; v_course uuid; v_expired jsonb;begin
 select * into a from public.exam_attempts where id=p_attempt and student_id=p_student;
 select course_id into v_course from public.exams where id=a.exam_id;
 if a.id is null or not private.content_student_eligible(p_student,v_course) then return jsonb_build_object('error','ITEM_NOT_FOUND');end if;
 v_expired:=private.finalize_expired_content_attempts(p_student);
 if not exists(select 1 from public.subject_items i join public.course_subjects s on s.id=i.subject_id join public.exams e on e.id=i.exam_id
  where e.id=a.exam_id and s.is_published and e.is_published) then return jsonb_build_object('error','ITEM_NOT_FOUND');end if;
 if a.status='en_progreso' and a.deadline_at<now() then
  select * into a from public.exam_attempts where id=p_attempt;return to_jsonb(a)||jsonb_build_object('_just_expired',true,'_expired_attempts',v_expired);end if;
 select * into a from public.exam_attempts where id=p_attempt;
 return to_jsonb(a)||jsonb_build_object('_expired_attempts',v_expired);
end $private_content_attempt_state$;
create function public.content_attempt_state(p_student uuid,p_attempt uuid) returns jsonb
language sql volatile security invoker set search_path='' as $public_content_attempt_state$ select private.content_attempt_state(p_student,p_attempt) $public_content_attempt_state$;
create function public.content_admin(p_actor uuid,p_action text,p_data jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $public_content_admin$ select private.content_admin(p_actor,p_action,p_data) $public_content_admin$;
create function public.content_student(p_student uuid,p_action text,p_data jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $public_content_student$ select private.content_student(p_student,p_action,p_data) $public_content_student$;
create function public.content_start_attempt(p_student uuid,p_exam uuid) returns jsonb
language sql volatile security invoker set search_path='' as $public_content_start_attempt$ select private.start_exam_attempt(p_student,p_exam) $public_content_start_attempt$;
create function public.content_finish_attempt(p_student uuid,p_attempt uuid,p_answers jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $public_content_finish_attempt$ select private.finish_content_attempt(p_student,p_attempt,p_answers) $public_content_finish_attempt$;
create function public.content_exam_access(p_student uuid,p_exam uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' as $public_content_exam_access$
declare i public.subject_items; s public.course_subjects;begin
 perform private.finalize_expired_content_attempts(p_student);
 select * into i from public.subject_items where exam_id=p_exam;
 select * into s from public.course_subjects where id=i.subject_id;
 if i.id is null or not s.is_published or not private.content_student_eligible(p_student,s.course_id) or not exists(select 1 from public.exams where id=p_exam and is_published) then
 return jsonb_build_object('error','ITEM_NOT_FOUND');end if;
 return private.resolve_item_access(p_student,i.id);
end $public_content_exam_access$;

-- Cerrar ACL antes del COMMIT intermedio, incluidos grants predeterminados.
do $close_content_api$ declare signature text; f regprocedure;begin
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
  if f is null then raise exception '066a: missing function %',signature;end if;
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $close_content_api$;
commit;
select '066a completa' as estado;
