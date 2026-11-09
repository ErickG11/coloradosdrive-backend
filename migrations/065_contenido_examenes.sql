-- F1. Aplicación MANUAL después de 063. 064 reservada. Ejecutar preflight primero.
begin;
set local lock_timeout = '5s';

-- Los dos triggers de 004 usaban tipos/tablas sin esquema y heredaban el
-- search_path del llamador. Calificarlos permite invocarlos desde private.
create or replace function public.enforce_attempt_student_role() returns trigger
language plpgsql security invoker set search_path='' as $$
declare student_role public.user_role;begin
 select rol into student_role from public.users where id=new.student_id;
 if student_role is distinct from 'estudiante' then raise exception 'exam_attempts.student_id (%) must reference a user with rol = estudiante',new.student_id;end if;
 return new;
end $$;
create or replace function public.enforce_option_question_type() returns trigger
language plpgsql security invoker set search_path='' as $$
declare q_type public.question_type;begin
 select type into q_type from public.questions where id=new.question_id;
 if q_type is distinct from 'opcion_multiple' then raise exception 'question_options.question_id (%) must reference a question with type = opcion_multiple',new.question_id;end if;
 return new;
end $$;

create table public.course_subjects (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses on delete restrict,
 title text not null check(char_length(btrim(title)) between 1 and 120), description text,
 order_index integer not null default 0, is_published boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint course_subjects_order unique(course_id,order_index) deferrable initially deferred
);
create unique index course_subjects_title on public.course_subjects(course_id,lower(btrim(title)));
create table public.course_materials (
 id uuid primary key default gen_random_uuid(), title text not null check(char_length(btrim(title)) between 1 and 120),
 description text, kind text not null check(kind in ('archivo','enlace','texto')),
 storage_path text unique, mime_type text, size_bytes integer, url text, body text,
 is_published boolean not null default false, created_by uuid references public.users on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((kind='archivo' and storage_path is not null and mime_type in ('application/pdf','image/png','image/jpeg') and size_bytes between 1 and 10485760 and url is null and body is null)
 or (kind='enlace' and url ~ '^https://[^[:space:]]+$' and storage_path is null and mime_type is null and size_bytes is null and body is null)
 or (kind='texto' and body is not null and char_length(body) between 1 and 20000 and storage_path is null and mime_type is null and size_bytes is null and url is null))
);
create table public.subject_items (
 id uuid primary key default gen_random_uuid(), subject_id uuid not null references public.course_subjects on delete restrict,
 kind text not null check(kind in ('material','examen')),
 material_id uuid unique references public.course_materials on delete restrict,
 exam_id uuid unique references public.exams on delete restrict,
 order_index integer not null default 0, obligatorio boolean not null default true,
 check ((kind='material' and material_id is not null and exam_id is null) or (kind='examen' and exam_id is not null and material_id is null)),
 constraint subject_items_order unique(subject_id,order_index) deferrable initially deferred
);
create table public.item_access_rules (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.subject_items on delete restrict,
 target_type text not null check(target_type in ('cohorte','estudiante')),
 cohort_id uuid references public.cohorts on delete cascade, student_id uuid references public.users on delete restrict,
 habilitado boolean not null default true, opens_at timestamptz, closes_at timestamptz,
 max_attempts integer check(max_attempts between 1 and 20), extra_minutes integer not null default 0 check(extra_minutes between 0 and 180),
 note text check(char_length(note)<=300), created_by uuid references public.users on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((target_type='cohorte' and cohort_id is not null and student_id is null) or (target_type='estudiante' and student_id is not null and cohort_id is null)),
 check(closes_at is null or opens_at is null or closes_at>opens_at)
);
create unique index item_access_rules_target on public.item_access_rules(item_id,target_type,(coalesce(cohort_id,student_id)));
create index item_access_rules_student on public.item_access_rules(student_id) where student_id is not null;
create table public.material_progress (
 student_id uuid not null references public.users on delete restrict,
 material_id uuid not null references public.course_materials on delete restrict,
 first_opened_at timestamptz not null default now(), completed_at timestamptz,
 primary key(student_id,material_id)
);
-- UUIDs de auditoría son instantáneas, sin FK hacia el alumno eliminado.
create table public.content_access_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null,
 action text not null check(action in ('crear','editar','revocar','intento_extra')),
 item_id uuid not null, target_type text not null check(target_type in ('cohorte','estudiante')),
 target_id uuid not null, snapshot jsonb not null, created_at timestamptz not null default now()
);
create index content_access_audit_item on public.content_access_audit(item_id,created_at);
-- Contador persistente, sin dependencia de un proceso ni de su memoria.
create table private.content_upload_limits (
 admin_id uuid not null, day date not null, used integer not null check(used between 1 and 50), primary key(admin_id,day)
);
alter table private.content_upload_limits enable row level security;
revoke all on private.content_upload_limits from public,anon,authenticated;

alter table public.exams add column max_attempts_default integer check(max_attempts_default between 1 and 20),
 add column shuffle_questions boolean not null default false, add column shuffle_options boolean not null default false,
 add column description text;
update public.exams set max_attempts_default=case when type='definitivo' then 1 else null end;
alter table public.exam_attempts add column attempt_number integer, add column deadline_at timestamptz,
 add column max_attempts_aplicado integer, add column minutos_aplicados integer;
with numbered as (select id,row_number() over(partition by exam_id,student_id order by started_at,id) n from public.exam_attempts)
 update public.exam_attempts a set attempt_number=n.n from numbered n where a.id=n.id;
update public.exam_attempts a set deadline_at=a.started_at+make_interval(mins=>e.time_limit_minutes),
 minutos_aplicados=e.time_limit_minutes,max_attempts_aplicado=e.max_attempts_default from public.exams e where a.exam_id=e.id;
alter table public.exam_attempts alter column attempt_number set not null, alter column deadline_at set not null,
 alter column minutos_aplicados set not null, add constraint exam_attempts_number_positive check(attempt_number>0),
 add constraint exam_attempts_number unique(exam_id,student_id,attempt_number);
-- No corregir duplicados silenciosamente: el preflight y este índice los rechazan.
create unique index exam_attempts_one_in_progress on public.exam_attempts(student_id,exam_id) where status='en_progreso';

insert into public.course_subjects(course_id,title,order_index)
 select id,'Exámenes anteriores (sin clasificar)',0 from public.courses;
insert into public.subject_items(subject_id,kind,exam_id,order_index)
 select s.id,'examen',e.id,row_number() over(partition by s.id order by e.created_at,e.id)::integer
 from public.course_subjects s join public.exams e on e.course_id=s.course_id;

alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check check(tipo in
 ('recordatorio_practica','resultado_cancelacion','cupo_disponible','sin_practica_instructor','cambio_realizado',
 'asistencia_corregida','encuesta_practica','documento_aprobado','documento_rechazado',
 'contenido_habilitado','examen_habilitado','intento_extra'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('course-content','course-content',false,10485760,array['application/pdf','image/png','image/jpeg']);
-- No concede acceso. Una política permisiva previa de otro módulo no debe
-- permitir descargar este bucket con un JWT de alumno/admin desde el cliente.
create policy course_content_backend_only on storage.objects as restrictive for all to anon,authenticated
 using (bucket_id<>'course-content') with check (bucket_id<>'course-content');

create function private.content_student_eligible(p_student uuid,p_course uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users u join public.enrollments e on e.student_id=u.id
 join public.cohorts c on c.id=e.cohort_id
 where u.id=p_student and u.rol='estudiante' and u.activo and not u.debe_cambiar_password
 and e.status='activo' and e.etapa_inscripcion='activa' and c.course_id=p_course and e.course_id=p_course
 and not exists(select 1 from public.student_deletion_operations d where d.student_id=u.id and d.status<>'completo')
 and not exists(select 1 from public.enrollments x where x.student_id=u.id and x.origen='solicitud'
 and x.status in ('activo','pendiente_cohorte') and x.etapa_inscripcion<>'activa'));
$$;

create function private.resolve_item_access(p_student uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.course_subjects; i public.subject_items; r public.item_access_rules; v_cohort uuid; v_max integer; v_published boolean; v_eligible boolean;
begin
 select * into i from public.subject_items where id=p_item;
 select * into s from public.course_subjects where id=i.subject_id;
 if s.id is null then
  return jsonb_build_object('estado','no_habilitado','fuente','ninguna','opens_at',null,'closes_at',null,'max_attempts',null,'extra_minutes',0); end if;
 v_eligible:=private.content_student_eligible(p_student,s.course_id);
 if i.kind='material' then select is_published into v_published from public.course_materials where id=i.material_id;
 else select is_published,max_attempts_default into v_published,v_max from public.exams where id=i.exam_id; end if;
 select e.cohort_id into v_cohort from public.enrollments e join public.cohorts c on c.id=e.cohort_id
 where e.student_id=p_student and e.status='activo' and e.etapa_inscripcion='activa' and c.course_id=s.course_id;
 select * into r from public.item_access_rules where item_id=p_item and
 ((target_type='estudiante' and student_id=p_student) or (target_type='cohorte' and cohort_id=v_cohort))
 order by case target_type when 'estudiante' then 0 else 1 end limit 1;
 return jsonb_build_object('estado',case when not v_eligible or not s.is_published or not coalesce(v_published,false) or r.id is null or not r.habilitado then 'no_habilitado'
 when r.opens_at>now() then 'programado' when r.closes_at<=now() then 'cerrado' else 'abierto' end,
 'fuente',coalesce(r.target_type,'ninguna'),'opens_at',r.opens_at,'closes_at',r.closes_at,
 'max_attempts',coalesce(r.max_attempts,v_max),'extra_minutes',coalesce(r.extra_minutes,0));
end $$;

-- Una sola implementación de vencimiento, compartida por inicio, envío, listados y progreso.
create function private.finalize_expired_content_attempts(p_student uuid default null,p_exam uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a public.exam_attempts; v_closed public.exam_attempts; v_total numeric; v_earned numeric; v_score numeric; v_pass numeric; v_done jsonb:='[]';
begin
 for a in select * from public.exam_attempts where status='en_progreso' and deadline_at<now()
 and (p_student is null or student_id=p_student) and (p_exam is null or exam_id=p_exam) order by id for update loop
  select coalesce(sum(points),0) into v_total from public.questions where exam_id=a.exam_id;
  select coalesce(sum(q.points),0) into v_earned from public.attempt_answers aa join public.questions q on q.id=aa.question_id
   where aa.attempt_id=a.id and aa.is_correct and q.exam_id=a.exam_id;
  select passing_score_percent into v_pass from public.exams where id=a.exam_id;
  v_score:=case when v_total>0 then 100*v_earned/v_total else 0 end;
  update public.exam_attempts set status='completado',completed_at=now(),score_percent=v_score,passed=(v_score>=v_pass) where id=a.id returning * into v_closed;
  v_done:=v_done||jsonb_build_array(to_jsonb(v_closed));
 end loop;
 return v_done;
end $$;

create function private.start_exam_attempt(p_student uuid,p_exam uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
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
end $$;

create function private.student_course_progress(p_student uuid,p_course uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_subjects jsonb; v_global numeric; v_complete boolean; v_n integer;
begin
 perform private.finalize_expired_content_attempts(p_student);
 with counts as (
 select s.id,s.title,s.order_index,count(i.id)::integer total,
 count(i.id) filter(where (i.kind='material' and exists(select 1 from public.material_progress p where p.student_id=p_student and p.material_id=i.material_id and p.completed_at is not null))
 or (i.kind='examen' and exists(select 1 from public.exam_attempts a where a.student_id=p_student and a.exam_id=i.exam_id and a.status='completado' and a.passed)))::integer done
 from public.course_subjects s left join public.subject_items i on i.subject_id=s.id and i.obligatorio and
 ((i.kind='material' and exists(select 1 from public.course_materials m where m.id=i.material_id and m.is_published)) or
 (i.kind='examen' and exists(select 1 from public.exams e where e.id=i.exam_id and e.is_published)))
 where s.course_id=p_course and s.is_published group by s.id
 ), fractions as (select *,case when total>0 then done::numeric/total else 0 end fraction from counts)
 select coalesce(jsonb_agg(jsonb_build_object('subject_id',id,'title',title,'obligatorios_totales',total,'completados',done,
 'porcentaje',case when total>0 and done=total then 100 else least(99.99,round(fraction*100,2)) end,
 'completa',total>0 and done=total) order by order_index,id),'[]'::jsonb),
 coalesce(avg(fraction) filter(where total>0)*100,0),coalesce(bool_and(done=total) filter(where total>0),false),count(*) filter(where total>0)
 into v_subjects,v_global,v_complete,v_n from fractions;
 return jsonb_build_object('materias',v_subjects,'global',case when v_complete then 100 else least(99.99,round(v_global,2)) end,
 'completa',v_complete,'sin_contenido',v_n=0,'certificado_listo',v_complete);
end $$;

create function private.content_consistency() returns trigger language plpgsql security definer set search_path='' as $$
declare v_course uuid; v_exam uuid;
begin
 if tg_table_name='subject_items' then
  select course_id into v_course from public.course_subjects where id=new.subject_id;
  if tg_op='UPDATE' and (new.material_id,new.exam_id,new.kind) is distinct from (old.material_id,old.exam_id,old.kind) then
   raise exception 'ITEM_IDENTITY_IMMUTABLE' using errcode='CF409';end if;
  if new.kind='examen' and not exists(select 1 from public.exams where id=new.exam_id and course_id=v_course) then
   raise exception 'ITEM_COURSE_MISMATCH' using errcode='CF409';end if;
  if tg_op='UPDATE' and new.subject_id<>old.subject_id and exists(select 1 from public.course_subjects where id=old.subject_id and course_id<>v_course) then
   raise exception 'ITEM_COURSE_MISMATCH' using errcode='CF409';end if;
 elsif tg_table_name='item_access_rules' then
  select s.course_id into v_course from public.subject_items i join public.course_subjects s on s.id=i.subject_id where i.id=new.item_id;
  if (new.max_attempts is not null or new.extra_minutes<>0) and not exists(select 1 from public.subject_items where id=new.item_id and kind='examen') then
   raise exception 'EXAM_RULE_ONLY' using errcode='CF409';end if;
  if new.closes_at<=now() then raise exception 'CLOSES_AT_PAST' using errcode='CF409';end if;
  if new.target_type='cohorte' and not exists(select 1 from public.cohorts where id=new.cohort_id and course_id=v_course) then
   raise exception 'TARGET_COURSE_MISMATCH' using errcode='CF409';end if;
  if new.target_type='estudiante' and not exists(select 1 from public.enrollments e join public.cohorts c on c.id=e.cohort_id
   where e.student_id=new.student_id and e.status='activo' and e.etapa_inscripcion='activa' and c.course_id=v_course and e.course_id=v_course) then
   raise exception 'TARGET_ENROLLMENT_REQUIRED' using errcode='CF409';end if;
 end if;
 return new;
end $$;
create trigger subject_items_consistency before insert or update on public.subject_items for each row execute function private.content_consistency();
create trigger item_access_rules_consistency before insert or update on public.item_access_rules for each row execute function private.content_consistency();

create function private.content_exam_guard() returns trigger language plpgsql security definer set search_path='' as $$
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
end $$;
create trigger content_exam_guard before update or delete on public.exams for each row execute function private.content_exam_guard();
create trigger content_question_guard before insert or update or delete on public.questions for each row execute function private.content_exam_guard();
create trigger content_option_guard before insert or update or delete on public.question_options for each row execute function private.content_exam_guard();

-- Un examen publicado debe seguir siendo válido al terminar cada transacción,
-- también al agregar/eliminar preguntas u opciones después de su publicación.
create function private.content_published_exam_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare v_exam uuid;begin
 if tg_table_name='questions' then v_exam:=case when tg_op='DELETE' then old.exam_id else new.exam_id end;
 else select exam_id into v_exam from public.questions where id=case when tg_op='DELETE' then old.question_id else new.question_id end;end if;
 if exists(select 1 from public.exams where id=v_exam and is_published) and
 (not exists(select 1 from public.questions where exam_id=v_exam) or exists(select 1 from public.questions q where q.exam_id=v_exam and q.type='opcion_multiple'
 and (select count(*) from public.question_options o where o.question_id=q.id and o.is_correct)<>1)) then
 raise exception 'EXAM_INVALID_QUESTIONS' using errcode='CF409';end if;
 return null;
end $$;
create constraint trigger content_published_question_guard after insert or update or delete on public.questions
 deferrable initially deferred for each row execute function private.content_published_exam_guard();
create constraint trigger content_published_option_guard after insert or update or delete on public.question_options
 deferrable initially deferred for each row execute function private.content_published_exam_guard();

create function private.content_attempt_immutable() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.exam_id,new.student_id,new.attempt_number,new.started_at,new.deadline_at,new.max_attempts_aplicado,new.minutos_aplicados)
 is distinct from (old.exam_id,old.student_id,old.attempt_number,old.started_at,old.deadline_at,old.max_attempts_aplicado,old.minutos_aplicados) then
 raise exception 'ATTEMPT_DEADLINE_IMMUTABLE' using errcode='CF409';end if;return new;
end $$;
create trigger content_attempt_immutable before update on public.exam_attempts for each row execute function private.content_attempt_immutable();

-- delete_student_data se extiende en 066, sobre su cuerpo vigente 060.
do $$ declare t text; begin
 foreach t in array array['course_subjects','course_materials','subject_items','item_access_rules','material_progress','content_access_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
-- ACL explícita para CADA función añadida, incluidas funciones de trigger.
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('content_student_eligible','resolve_item_access','finalize_expired_content_attempts',
 'start_exam_attempt','student_course_progress','content_consistency','content_exam_guard','content_attempt_immutable','content_published_exam_guard') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
