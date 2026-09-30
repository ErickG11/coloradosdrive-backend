-- 020_matricula_manual_simplificada.sql
-- Matrícula manual simplificada (ADR-010). Aplicar después de 018 y 019.
-- Preflight: pendientes antiguos necesitan un mapa EXPLÍCITO por inscripción:
-- SET coloradosdrive.pending_course_map = '{"enrollment_uuid":"course_uuid"}';
-- No se infiere el tipo por nombre, orden, precio ni otras matrículas.
begin;
set local lock_timeout = '5s';
lock table public.enrollments in access exclusive mode;

alter table public.courses add constraint courses_id_tipo_unique unique (id, tipo);
alter table public.cohorts add constraint cohorts_id_course_unique unique (id, course_id);
create table public.manual_course_catalog (
  tipo public.course_type primary key,
  course_id uuid not null unique,
  foreign key (course_id, tipo) references public.courses(id, tipo) on delete restrict
);
comment on table public.manual_course_catalog is
  'Curso designado explícitamente para la sugerencia automática por tipo. Con duplicados requiere configuración administrativa; las cohortes manuales pueden pertenecer a otro curso del mismo tipo.';
insert into public.manual_course_catalog(tipo, course_id)
select tipo, (array_agg(id))[1] from public.courses group by tipo having count(*) = 1;

alter table public.enrollments add column course_id uuid, add column course_type public.course_type,
  add column practice_plan jsonb;
update public.enrollments e set course_id = c.course_id from public.cohorts c where c.id = e.cohort_id;
update public.enrollments set course_id =
  (nullif(current_setting('coloradosdrive.pending_course_map', true), '')::jsonb ->> id::text)::uuid
where course_id is null;
do $$ begin
  if exists(select 1 from public.enrollments where course_id is null) then
    raise exception 'Matrículas pendientes sin curso solicitado: proporcionar pending_course_map explícito antes de aplicar; no se modificaron datos';
  end if;
end $$;
update public.enrollments e set course_type = c.tipo from public.courses c where c.id = e.course_id;
alter table public.enrollments alter column course_id set not null, alter column course_type set not null,
  add constraint enrollments_course_type_fkey foreign key(course_id, course_type)
    references public.courses(id, tipo) on delete restrict,
  add constraint enrollments_cohort_course_fkey foreign key(cohort_id, course_id)
    references public.cohorts(id, course_id) on delete restrict;
drop index public.enrollments_one_active_per_student;
alter table public.enrollments drop constraint enrollments_student_cohort_unique;
create unique index enrollments_one_current_per_type on public.enrollments(student_id, course_type)
  where status in ('activo', 'pendiente_cohorte');
comment on table public.enrollments is
  'Vigentes: activo y pendiente_cohorte, máximo una por estudiante y tipo A/B. Terminales: finalizado y retirado; no bloquean nuevas inscripciones.';
create function public.enrollment_resolve_course() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_course uuid; v_type public.course_type;
begin
  if new.cohort_id is not null then
    select course_id into v_course from public.cohorts where id = new.cohort_id;
    if new.course_id is not null and new.course_id <> v_course then
      raise exception 'La cohorte no corresponde al curso solicitado' using errcode = 'CD020';
    end if;
    new.course_id := v_course;
  end if;
  select tipo into v_type from public.courses where id = new.course_id;
  if v_type is null then
    raise exception 'Es obligatorio conservar el curso solicitado, incluso sin cohorte' using errcode = 'CD020';
  end if;
  new.course_type := v_type;
  return new;
end $$;
create trigger enrollments_00_resolve_course before insert or update of course_id, course_type, cohort_id
  on public.enrollments for each row execute function public.enrollment_resolve_course();

create table public.manual_enrollment_operations (
  id uuid primary key,
  actor_id uuid not null references public.users(id) on delete restrict,
  request_hash text not null,
  worker_id uuid not null,
  phase text not null check(phase in ('processing','failed','needs_review','committed')),
  student_id uuid,
  student_created boolean not null default false,
  response jsonb,
  email_status text not null default 'pending' check(email_status in ('pending','sending','sent','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.manual_enrollment_operations is
  'Idempotencia administrativa. Sin contraseñas ni tokens. Processing no se roba por timeout: un proceso interrumpido exige reconciliación para no duplicar Auth o compensar un commit incierto.';
alter table public.manual_course_catalog enable row level security;
alter table public.manual_enrollment_operations enable row level security;
revoke all on public.manual_course_catalog, public.manual_enrollment_operations from public, anon, authenticated;
grant select, insert, update, delete on public.manual_course_catalog, public.manual_enrollment_operations to service_role;

create function public.reserve_manual_enrollment(p_id uuid, p_actor uuid, p_hash text, p_worker uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare op public.manual_enrollment_operations;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  insert into public.manual_enrollment_operations(id,actor_id,request_hash,worker_id,phase)
    values(p_id,p_actor,p_hash,p_worker,'processing') on conflict(id) do nothing;
  select * into op from public.manual_enrollment_operations where id=p_id for update;
  if op.actor_id <> p_actor or op.request_hash <> p_hash then
    raise exception 'Clave de idempotencia utilizada con otra operación' using errcode='CD021';
  end if;
  if op.phase='failed' then
    update public.manual_enrollment_operations set phase='processing',worker_id=p_worker,updated_at=now()
      where id=p_id returning * into op;
  end if;
  return to_jsonb(op) || jsonb_build_object('claimed',op.worker_id=p_worker and op.phase='processing');
end $$;

create function public.commit_manual_enrollment(
  p_id uuid, p_worker uuid, p_student uuid, p_profile jsonb, p_course uuid,
  p_cohort uuid, p_plan jsonb, p_scheduled_ats timestamptz[], p_instructor uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare op public.manual_enrollment_operations; c public.cohorts;
  e public.enrollments; v_type public.course_type; v_slots integer := 0; v_response jsonb;
begin
  select * into op from public.manual_enrollment_operations where id=p_id for update;
  if not found or op.phase <> 'processing' or op.worker_id <> p_worker then
    raise exception 'Operación no reservada por este proceso' using errcode='CD021';
  end if;
  if not exists(select 1 from public.users where id=op.actor_id and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  select tipo into strict v_type from public.courses where id=p_course;
  if p_cohort is not null then
    select * into strict c from public.cohorts where id=p_cohort for update;
    if c.course_id <> p_course then raise exception 'Cohorte de otro curso' using errcode='CD020'; end if;
    if (clock_timestamp() at time zone 'America/Guayaquil')::date
      not between c.fecha_inicio_matricula and c.fecha_fin_matricula then
      raise exception 'La matrícula de la cohorte ya no está abierta' using errcode='CD020';
    end if;
  elsif cardinality(p_scheduled_ats)>0 then
    raise exception 'Una matrícula pendiente no puede generar franjas' using errcode='CD020';
  end if;
  if p_profile is not null then
    if op.student_id is distinct from p_student or not op.student_created then
      raise exception 'Cuenta nueva no registrada en la operación' using errcode='CD021';
    end if;
    insert into public.users(id,cedula,nombre_completo,telefono,rol,debe_cambiar_password)
    values(p_student,p_profile->>'cedula',p_profile->>'nombreCompleto',nullif(p_profile->>'telefono',''),
      'estudiante',true);
  elsif op.student_created then
    raise exception 'Falta perfil de la cuenta nueva' using errcode='CD021';
  end if;
  insert into public.enrollments(student_id,course_id,course_type,cohort_id,status,monto_total,practice_plan)
    values(p_student,p_course,v_type,p_cohort,
      case when p_cohort is null then 'pendiente_cohorte'::public.enrollment_status else 'activo'::public.enrollment_status end,
      case when p_cohort is null then null else c.precio end,p_plan) returning * into e;
  if cardinality(p_scheduled_ats)>0 then
    insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status)
      select p_cohort,p_instructor,p_student,t,60,'asignado' from unnest(p_scheduled_ats) t;
    get diagnostics v_slots = row_count;
  end if;
  v_response := jsonb_build_object('operationId',p_id,'studentId',p_student,'studentCreated',op.student_created,
    'enrollmentId',e.id,'courseId',p_course,'courseType',v_type,'cohortId',p_cohort,'status',e.status,
    'slotsCreated',v_slots,'plan',p_plan);
  update public.manual_enrollment_operations set phase='committed',response=v_response,
    student_id=p_student,updated_at=now() where id=p_id;
  return v_response;
end $$;

create function public.claim_manual_enrollment_email(p_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.manual_enrollment_operations set email_status='sending',updated_at=now()
  where id=p_id and phase='committed' and email_status in ('pending','failed');
  return found;
end $$;
create function public.abort_manual_enrollment(p_id uuid,p_worker uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare op public.manual_enrollment_operations;
begin
  -- Espera a cualquier commit en vuelo y lo cerca antes de compensar Auth.
  select * into strict op from public.manual_enrollment_operations where id=p_id for update;
  if op.phase='processing' and op.worker_id=p_worker then
    update public.manual_enrollment_operations set phase='needs_review',updated_at=now()
      where id=p_id returning * into op;
  end if;
  return to_jsonb(op);
end $$;
-- Lookup administrativo estrecho en Auth: no conceder SELECT general de
-- auth.users ni exponer una función DEFINER en el esquema de la Data API.
create schema if not exists coloradosdrive_private;
revoke all on schema coloradosdrive_private from public, anon, authenticated;
grant usage on schema coloradosdrive_private to service_role;
create function coloradosdrive_private.find_manual_students(p_actor uuid, p_query text)
returns table(id uuid, cedula text, nombre_completo text, correo text)
language sql stable security definer set search_path = '' as $$
  select u.id,u.cedula::text,u.nombre_completo,a.email::text
  from public.users u join auth.users a on a.id=u.id
  where u.rol='estudiante' and (u.cedula=p_query or lower(a.email)=lower(p_query))
    and exists(select 1 from public.users admin where admin.id=p_actor and admin.rol='admin')
  limit 10;
$$;
revoke all on function coloradosdrive_private.find_manual_students(uuid,text) from public,anon,authenticated;
grant execute on function coloradosdrive_private.find_manual_students(uuid,text) to service_role;
create function public.find_manual_students(p_actor uuid,p_query text)
returns table(id uuid,cedula text,nombre_completo text,correo text)
language sql stable security invoker set search_path = '' as $$
  select * from coloradosdrive_private.find_manual_students(p_actor,p_query);
$$;
revoke all on function public.find_manual_students(uuid,text) from public,anon,authenticated;
grant execute on function public.find_manual_students(uuid,text) to service_role;
revoke all on function public.enrollment_resolve_course(),
  public.reserve_manual_enrollment(uuid,uuid,text,uuid),
  public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid),
  public.abort_manual_enrollment(uuid,uuid),
  public.claim_manual_enrollment_email(uuid) from public,anon,authenticated;
grant execute on function public.enrollment_resolve_course(),
  public.reserve_manual_enrollment(uuid,uuid,text,uuid),
  public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid),
  public.abort_manual_enrollment(uuid,uuid),
  public.claim_manual_enrollment_email(uuid) to service_role;
-- Los triggers históricos conservan sus reglas y locks, pero ahora resuelven
-- tablas/tipos explícitos incluso desde una RPC con search_path vacío.
create or replace function public.enforce_enrollment_student_role()
returns trigger
language plpgsql security invoker set search_path = ''
as $
declare
  student_role public.user_role;
begin
  select rol into student_role from public.users where id = new.student_id;

  if student_role is distinct from 'estudiante' then
    raise exception 'enrollments.student_id (%) must reference a user with rol = estudiante', new.student_id;
  end if;

  return new;
end;
$;

create or replace function public.enforce_practice_slot_instructor_role()
returns trigger
language plpgsql security invoker set search_path = ''
as $
declare
  instructor_role public.user_role;
begin
  select rol into instructor_role from public.users where id = new.instructor_id;

  if instructor_role is distinct from 'instructor' then
    raise exception 'practice_slots.instructor_id (%) must reference a user with rol = instructor', new.instructor_id;
  end if;

  return new;
end;
$;

create or replace function public.enforce_practice_slot_student_role()
returns trigger
language plpgsql security invoker set search_path = ''
as $
declare
  student_role public.user_role;
begin
  if new.student_id is null then
    return new;
  end if;

  select rol into student_role from public.users where id = new.student_id;

  if student_role is distinct from 'estudiante' then
    raise exception 'practice_slots.student_id (%) must reference a user with rol = estudiante', new.student_id;
  end if;

  return new;
end;
$;

create or replace function public.enforce_cohort_cupo()
returns trigger
language plpgsql security invoker set search_path = ''
as $
declare
  v_cupo integer;
  v_ocupados integer;
begin
  -- Una fila pendiente_cohorte (cohort_id null) o que no queda 'activo'
  -- (finalizado/retirado) no consume cupo de ninguna cohorte.
  if NEW.cohort_id is null or NEW.status <> 'activo' then
    return NEW;
  end if;

  -- En UPDATE, si ni cohort_id ni status cambiaron, no hay nada que
  -- reverificar (evita re-lockear/recontar en cada UPDATE no relacionado).
  if TG_OP = 'UPDATE'
     and NEW.cohort_id is not distinct from OLD.cohort_id
     and NEW.status is not distinct from OLD.status then
    return NEW;
  end if;

  select cupo_maximo into v_cupo
  from public.cohorts
  where id = NEW.cohort_id
  for update;

  if not found then
    raise exception 'La cohorte % no existe', NEW.cohort_id;
  end if;

  select count(*) into v_ocupados
  from public.enrollments
  where cohort_id = NEW.cohort_id
    and status = 'activo'
    and id <> NEW.id;

  if v_ocupados >= v_cupo then
    -- Código de error propio (no colisiona con ningún SQLSTATE estándar
    -- de Postgres) para que la capa de aplicación lo distinga de
    -- cualquier otra violación de constraint y lo traduzca a un 409 claro.
    raise exception 'La cohorte % ya alcanzó su cupo máximo (%)', NEW.cohort_id, v_cupo
      using errcode = 'CD001';
  end if;

  return NEW;
end;
$;

notify pgrst, 'reload schema';
commit;
