-- RF-04 A. Aplicacion MANUAL en SQL Editor despues de rf04-a-preflight.sql.
-- No requiere backend/frontend RF-04 desplegados. No genera encuestas historicas.
begin;
set local lock_timeout = '5s';

-- Bloquear escrituras de franjas durante la instalacion; el corte se fija al final.
lock table public.practice_slots in share row exclusive mode;

-- Firmas/cuerpos reales de 030 y 034; abortar ante drift.
do $rf04$ declare sig text; expected text; actual text;
begin
 if to_regclass('public.practice_ratings') is not null or to_regclass('private.practice_rating_rollout') is not null then raise exception '035 ya existe total o parcialmente'; end if;
 foreach sig in array array[
 'public.register_practice_attendance(uuid,uuid,boolean)', 'public.correct_practice_attendance(uuid,uuid,boolean,text)',
 'private.guard_student_deletion_write()', 'private.assert_student_not_deleting(uuid)', 'private.trim_attendance_reason(text)',
 'private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)', 'private.enqueue_attendance_correction(uuid)',
 'private.attendance_correction_window_open(timestamptz,integer,timestamptz)', 'public.begin_student_deletion(uuid,uuid,text)',
 'public.advance_student_deletion(uuid,uuid,text,timestamptz,text)',
 'public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'] loop
 if to_regprocedure(sig) is null then raise exception 'Falta dependencia: %', sig; end if; end loop;
 foreach sig in array array['public.users','public.practice_slots','public.practice_attendance_events','public.notifications',
 'public.student_deletion_operations','public.practice_slot_cancellations'] loop
 if to_regclass(sig) is null then raise exception 'Falta tabla: %', sig; end if; end loop;
 sig := 'private.write_practice_attendance(uuid,uuid,boolean,boolean,text)'; expected := '87a885c0e9275c571a0cb24021a28a47';
 select md5(replace(prosrc, E'\r', '')) into actual from pg_proc where oid=to_regprocedure(sig);
 if actual is distinct from expected then raise exception 'Cuerpo inesperado de %; requiere version del repo 030/034',sig; end if;
 sig := 'public.delete_student_data(uuid,uuid,timestamptz,text[])'; expected := '98b197963ee227e342ad719bfa92a0b6';
 select md5(replace(prosrc, E'\r', '')) into actual from pg_proc where oid=to_regprocedure(sig);
 if actual is distinct from expected then raise exception 'Cuerpo inesperado de %; requiere version del repo 030/034',sig; end if;
 for sig, expected in select * from (values
   ('private.assert_student_not_deleting(uuid)', '13eea320880cd7c9f7d053f6d28f4933'),
   ('private.guard_student_deletion_write()', '90af686ae49185f0727e86bde541971b'),
   ('private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)', 'e5502b68a382ae3c5d59970c2fb0cb43')
 ) required(signature, body_hash) loop
   select md5(replace(prosrc, E'\r', '')) into actual from pg_proc where oid=to_regprocedure(sig);
   if actual is distinct from expected then raise exception 'Dependencia modificada: %; revisar antes de aplicar',sig; end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.practice_slots'::regclass and tgname='practice_slots_attendance_audit' and tgenabled='O') then raise exception 'Falta trigger de auditoria 034'; end if;
 if to_regclass('public.notifications_automatic_unique') is null then raise exception 'Falta indice 034'; end if;
end; $rf04$;

do $rf04_columns$
declare dep record;
begin
  for dep in select * from (values
    ('public.practice_slots','id','uuid'), ('public.practice_slots','student_id','uuid'),
    ('public.practice_slots','instructor_id','uuid'), ('public.practice_slots','cohort_id','uuid'),
    ('public.practice_slots','scheduled_at','timestamptz'), ('public.practice_slots','duration_minutes','integer'),
    ('public.practice_slots','status','public.practice_slot_status'), ('public.practice_slots','attended','boolean'),
    ('public.practice_attendance_events','id','uuid'), ('public.practice_attendance_events','slot_id','uuid'),
    ('public.practice_attendance_events','student_id','uuid'), ('public.practice_attendance_events','instructor_id','uuid'),
    ('public.practice_attendance_events','cohort_id','uuid'), ('public.practice_attendance_events','scheduled_at','timestamptz'),
    ('public.practice_attendance_events','duration_minutes','integer'), ('public.practice_attendance_events','created_at','timestamptz'),
    ('public.practice_attendance_events','transaction_id','bigint'), ('public.practice_attendance_events','motivo','text'),
    ('public.practice_attendance_events','tipo','text'), ('public.practice_attendance_events','previous_attended','boolean'),
    ('public.practice_attendance_events','new_attended','boolean'),
    ('public.notifications','user_id','uuid'), ('public.notifications','tipo','text'),
    ('public.notifications','practice_slot_id','uuid'), ('public.notifications','attendance_event_id','uuid'),
    ('public.notifications','email_status','text'),
    ('public.student_deletion_operations','student_id','uuid'), ('public.student_deletion_operations','phase','text'),
    ('public.student_deletion_operations','status','text'), ('public.student_deletion_operations','updated_at','timestamptz')
  ) required(relation_name, column_name, type_name) loop
    if not exists(select 1 from pg_attribute where attrelid=to_regclass(dep.relation_name)
      and attname=dep.column_name and not attisdropped and atttypid=to_regtype(dep.type_name)) then
      raise exception 'Columna faltante o tipo inesperado: %.% (%)',dep.relation_name,dep.column_name,dep.type_name;
    end if;
  end loop;
  if exists(select 1 from pg_proc where oid in (
    'private.write_practice_attendance(uuid,uuid,boolean,boolean,text)'::regprocedure,
    'public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure,
    'private.guard_student_deletion_write()'::regprocedure) and prosecdef) then
    raise exception 'Se esperaba SECURITY INVOKER en las dependencias'; end if;
end;
$rf04_columns$;

create table private.practice_rating_rollout (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz not null check (isfinite(enabled_at))
);
comment on table private.practice_rating_rollout is
  'Corte unico RF-04: solo practicas cuyo fin sea estrictamente posterior a enabled_at. No modificar en produccion.';
alter table private.practice_rating_rollout enable row level security;
revoke all on private.practice_rating_rollout from public, anon, authenticated, service_role;
grant select on private.practice_rating_rollout to service_role;

alter table public.practice_slots add column rating_window_opens_at timestamptz;
alter table public.practice_slots add constraint practice_slots_rating_window_check check (
  rating_window_opens_at is null or (attended is true and isfinite(rating_window_opens_at)
    and rating_window_opens_at >= scheduled_at + make_interval(mins => duration_minutes) + interval '5 minutes')
);
comment on column public.practice_slots.rating_window_opens_at is
  'RF-04: max(fin+5min, created_at del evento que registra/corrige a true). NULL al no asistir. Cierra exactamente 24h despues.';
create index practice_slots_rating_pending_idx on public.practice_slots(student_id, rating_window_opens_at, id)
  where status = 'completado' and attended is true and rating_window_opens_at is not null;

create table public.practice_ratings (
  id uuid primary key default gen_random_uuid(),
  practice_slot_id uuid not null references public.practice_slots(id) on delete restrict,
  student_id uuid not null references public.users(id) on delete restrict,
  instructor_id uuid not null references public.users(id) on delete restrict,
  score smallint not null check (score between 1 and 5),
  comment text check (comment is null or (comment = private.trim_attendance_reason(comment)
    and char_length(comment) between 1 and 1000)),
  created_at timestamptz not null default clock_timestamp(),
  invalidated_at timestamptz,
  invalidation_reason text,
  invalidation_event_id uuid references public.practice_attendance_events(id) on delete restrict,
  constraint practice_ratings_one_per_practice unique (practice_slot_id),
  constraint practice_ratings_invalidation_check check (
    (invalidated_at is null and invalidation_reason is null and invalidation_event_id is null)
    or (invalidated_at is not null and isfinite(invalidated_at) and invalidated_at >= created_at
      and invalidation_reason is not null and char_length(invalidation_reason) between 10 and 500
      and invalidation_event_id is not null)
  )
);
create index practice_ratings_instructor_current_idx
  on public.practice_ratings(instructor_id, created_at desc, id desc) include (score)
  where invalidated_at is null;
create index practice_ratings_student_idx on public.practice_ratings(student_id);
create index practice_ratings_instructor_idx on public.practice_ratings(instructor_id);
create index practice_ratings_invalidation_event_idx on public.practice_ratings(invalidation_event_id)
  where invalidation_event_id is not null;
alter table public.practice_ratings enable row level security;
revoke all on public.practice_ratings from public, anon, authenticated, service_role;
grant select, insert, delete on public.practice_ratings to service_role;
grant update(invalidated_at, invalidation_reason, invalidation_event_id) on public.practice_ratings to service_role;
comment on table public.practice_ratings is
  'RF-04: respuesta unica e inmutable. Anulacion definitiva por correccion auditada; limpieza solo dentro de eliminacion del alumno.';

-- Nuevo tipo compatible con el helper/indice parcial de 034: un aviso por practica,
-- sin attendance_event_id y solo bandeja. Una correccion no duplica el aviso.
alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check check (tipo in (
  'recordatorio_practica', 'resultado_cancelacion', 'cupo_disponible',
  'sin_practica_instructor', 'cambio_realizado', 'asistencia_corregida', 'encuesta_practica'));
alter table public.notifications add constraint notifications_rating_inbox_check check (
  tipo <> 'encuesta_practica' or (practice_slot_id is not null and email_status is null)
);

-- Orden de locks: alumno -> franja -> calificacion, compatible con 026/034.
create function private.lock_rateable_practice(p_slot uuid, p_student uuid)
returns public.practice_slots language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare s public.practice_slots; v_now timestamptz; v_cut timestamptz;
begin
  perform 1 from public.users where id = p_student and activo and rol = 'estudiante' for share;
  if not found then raise exception 'Cuenta de alumno inactiva o sin permiso' using errcode = 'RT403'; end if;
  perform private.assert_student_not_deleting(p_student);
  select * into s from public.practice_slots where id = p_slot and student_id = p_student for update;
  if not found then raise exception 'Practica no encontrada' using errcode = 'RT404'; end if;
  -- Prioridad al duplicado incluso si despues se anulo o vencio: nunca hay segunda encuesta.
  if exists(select 1 from public.practice_ratings where practice_slot_id = p_slot) then
    raise exception 'La encuesta de esta practica ya fue respondida' using errcode = 'RT409'; end if;
  v_now := clock_timestamp();
  select enabled_at into strict v_cut from private.practice_rating_rollout where singleton;
  if s.status <> 'completado' or s.attended is distinct from true
    or s.scheduled_at + make_interval(mins => s.duration_minutes) <= v_cut
    or s.rating_window_opens_at is null or v_now < s.rating_window_opens_at then
    raise exception 'La practica aun no habilita una encuesta' using errcode = 'RT412'; end if;
  if v_now >= s.rating_window_opens_at + interval '24 hours' then
    raise exception 'Termino el plazo de 24 horas para calificar' using errcode = 'RT410'; end if;
  return s;
end;
$$;

-- Defensa tambien para INSERT/UPDATE/DELETE directo usando service_role.
create function private.guard_practice_rating()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare s public.practice_slots; e public.practice_attendance_events;
begin
  if tg_op = 'INSERT' then
    s := private.lock_rateable_practice(new.practice_slot_id, new.student_id);
    if new.instructor_id is distinct from s.instructor_id or new.invalidated_at is not null
      or new.invalidation_reason is not null or new.invalidation_event_id is not null then
      raise exception 'Datos de calificacion invalidos' using errcode = '22023'; end if;
    -- La fecha de envio nunca la decide el cliente.
    new.created_at := clock_timestamp();
    if new.created_at >= s.rating_window_opens_at + interval '24 hours' then
      raise exception 'Termino el plazo de 24 horas para calificar' using errcode = 'RT410'; end if;
    return new;
  elsif tg_op = 'DELETE' then
    if not exists(select 1 from public.student_deletion_operations o join public.users u on u.id = o.student_id
      where o.student_id = old.student_id and o.phase = 'storage' and o.status <> 'completo' and not u.activo) then
      raise exception 'Solo se elimina al limpiar los datos del alumno' using errcode = 'RT403'; end if;
    return old;
  end if;
  if (to_jsonb(new) - 'invalidated_at' - 'invalidation_reason' - 'invalidation_event_id')
      is distinct from (to_jsonb(old) - 'invalidated_at' - 'invalidation_reason' - 'invalidation_event_id')
    or old.invalidated_at is not null then
    raise exception 'La respuesta y su anulacion son inmutables' using errcode = 'RT403'; end if;
  select * into e from public.practice_attendance_events where id = new.invalidation_event_id
    and slot_id = old.practice_slot_id and student_id = old.student_id and instructor_id = old.instructor_id
    and tipo = 'correccion' and previous_attended is true and new_attended is false
    and transaction_id = txid_current();
  if not found or new.invalidated_at is distinct from e.created_at
    or new.invalidation_reason is distinct from e.motivo then
    raise exception 'La anulacion requiere la correccion auditada de esta transaccion' using errcode = 'RT403'; end if;
  return new;
end;
$$;
create trigger practice_ratings_guard before insert or update or delete on public.practice_ratings
  for each row execute function private.guard_practice_rating();
-- Guard existente de 026, sin reemplazar su cuerpo ni su firma.
create trigger practice_ratings_deletion_guard before insert on public.practice_ratings
  for each row execute function private.guard_student_deletion_write();

-- Impedir mover/reabrir la ventana por un UPDATE REST o durante una reasignacion.
create function private.guard_practice_rating_window()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_cut timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.rating_window_opens_at is not null then
      raise exception 'La ventana requiere un evento de asistencia' using errcode = 'RT403'; end if;
  elsif new.rating_window_opens_at is distinct from old.rating_window_opens_at then
    select enabled_at into strict v_cut from private.practice_rating_rollout where singleton;
    if not exists(select 1 from public.practice_attendance_events e
      where e.slot_id = new.id and e.transaction_id = txid_current()
        and e.student_id = new.student_id and e.instructor_id = new.instructor_id
        and e.cohort_id = new.cohort_id and e.scheduled_at = new.scheduled_at
        and e.duration_minutes = new.duration_minutes
        and e.previous_attended is not distinct from old.attended and e.new_attended = new.attended
        and new.rating_window_opens_at is not distinct from case
          when e.new_attended and new.scheduled_at + make_interval(mins => new.duration_minutes) > v_cut
          then greatest(new.scheduled_at + make_interval(mins => new.duration_minutes) + interval '5 minutes', e.created_at)
          else null::timestamptz end) then
      raise exception 'La ventana requiere un evento de asistencia de esta transaccion' using errcode = 'RT403'; end if;
  end if;
  return new;
end;
$$;
create trigger practice_slots_rating_window_guard before insert or update of rating_window_opens_at on public.practice_slots
  for each row execute function private.guard_practice_rating_window();

create function public.submit_practice_rating(p_slot uuid, p_student uuid, p_score numeric, p_comment text default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare s public.practice_slots; r public.practice_ratings; v_comment text;
begin
  if p_score is null or p_score not between 1 and 5 or p_score <> trunc(p_score) then
    raise exception 'score debe ser un entero entre 1 y 5' using errcode = '22023'; end if;
  v_comment := nullif(private.trim_attendance_reason(p_comment), '');
  if char_length(v_comment) > 1000 then
    raise exception 'comment admite como maximo 1000 caracteres' using errcode = '22023'; end if;
  s := private.lock_rateable_practice(p_slot, p_student);
  insert into public.practice_ratings(practice_slot_id, student_id, instructor_id, score, comment)
    values(s.id, p_student, s.instructor_id, p_score::smallint, v_comment) returning * into r;
  return jsonb_build_object('id', r.id, 'practiceSlotId', r.practice_slot_id,
    'score', r.score, 'comment', r.comment, 'createdAt', r.created_at);
exception when unique_violation then
  -- El lock serializa el flujo normal; UNIQUE es la ultima defensa entre escritores.
  raise exception 'La encuesta de esta practica ya fue respondida' using errcode = 'RT409';
end;
$$;

create function public.list_student_pending_practice_ratings(p_student uuid, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare v_result jsonb; v_now timestamptz := clock_timestamp();
begin
  if not exists(select 1 from public.users where id = p_student and activo and rol = 'estudiante') then
    raise exception 'Cuenta de alumno inactiva o sin permiso' using errcode = 'RT403'; end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Paginacion invalida' using errcode = '22023'; end if;
  with matched as materialized (
    select s.id, u.nombre_completo, s.scheduled_at, s.rating_window_opens_at
    from public.practice_slots s join public.users u on u.id = s.instructor_id
    cross join private.practice_rating_rollout cut
    where cut.singleton and s.student_id = p_student and s.status = 'completado' and s.attended is true
      and s.scheduled_at + make_interval(mins => s.duration_minutes) > cut.enabled_at
      and s.rating_window_opens_at <= v_now
      and v_now < s.rating_window_opens_at + interval '24 hours'
      and not exists(select 1 from public.practice_ratings r where r.practice_slot_id = s.id)
  ), page_rows as (
    select * from matched order by rating_window_opens_at, id limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
    'practiceSlotId', id, 'instructorName', nombre_completo, 'scheduledAt', scheduled_at,
    'opensAt', rating_window_opens_at, 'closesAt', rating_window_opens_at + interval '24 hours')
    order by rating_window_opens_at, id) from page_rows), '[]'::jsonb),
    'total', (select count(*) from matched), 'page', p_page, 'pageSize', p_page_size) into v_result;
  return v_result;
end;
$$;

-- Mismo patron de list_admin_students: actor verificado, JSON y paginacion en SQL.
create function public.list_admin_instructor_ratings(p_actor uuid, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists(select 1 from public.users where id = p_actor and activo and rol = 'admin') then
    raise exception 'Solo el administrador puede consultar calificaciones' using errcode = 'RT403'; end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Paginacion invalida' using errcode = '22023'; end if;
  with scores as (
    select r.instructor_id, avg(r.score) as average, count(*) as responses
    from public.practice_ratings r join public.practice_slots s on s.id = r.practice_slot_id
    where r.invalidated_at is null and s.attended is true and s.status = 'completado'
      and s.student_id = r.student_id and s.instructor_id = r.instructor_id
    group by r.instructor_id
  ), matched as materialized (
    select u.id, u.nombre_completo, u.activo, sc.average, coalesce(sc.responses, 0) as responses,
      coalesce(sc.responses, 0) >= 3 as eligible
    from public.users u left join scores sc on sc.instructor_id = u.id where u.rol = 'instructor'
  ), page_rows as (
    select * from matched order by eligible desc, average desc nulls last, responses desc, nombre_completo, id
      limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
    'instructorId', id, 'instructorName', nombre_completo, 'active', activo,
    'average', round(average, 2), 'responses', responses, 'rankingEligible', eligible,
    'label', case when eligible then null else 'pocas calificaciones' end)
    order by eligible desc, average desc nulls last, responses desc, nombre_completo, id) from page_rows), '[]'::jsonb),
    'total', (select count(*) from matched), 'page', p_page, 'pageSize', p_page_size) into v_result;
  return v_result;
end;
$$;

create function public.admin_instructor_rating_detail(p_actor uuid, p_instructor uuid, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists(select 1 from public.users where id = p_actor and activo and rol = 'admin') then
    raise exception 'Solo el administrador puede consultar calificaciones' using errcode = 'RT403'; end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Paginacion invalida' using errcode = '22023'; end if;
  if not exists(select 1 from public.users where id = p_instructor and rol = 'instructor') then
    raise exception 'Instructor no encontrado' using errcode = 'RT404'; end if;
  with matched as materialized (
    select r.id, r.score, r.comment, r.created_at
    from public.practice_ratings r join public.practice_slots s on s.id = r.practice_slot_id
    where r.instructor_id = p_instructor and r.invalidated_at is null and s.attended is true
      and s.status = 'completado' and s.student_id = r.student_id and s.instructor_id = r.instructor_id
  ), page_rows as (
    select * from matched order by created_at desc, id desc limit p_page_size offset (p_page - 1) * p_page_size
  )
  -- No exponer alumno, franja, cohorte, horarios ni IDs que permitan cruzar la respuesta.
  select jsonb_build_object('instructorId', p_instructor, 'average', round(avg(score), 2),
    'responses', count(*), 'rankingEligible', count(*) >= 3,
    'label', case when count(*) >= 3 then null else 'pocas calificaciones' end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('score', score, 'comment', comment)
      order by created_at desc, id desc) from page_rows), '[]'::jsonb),
    'total', count(*), 'page', p_page, 'pageSize', p_page_size) into v_result from matched;
  return v_result;
end;
$$;

create or replace function private.write_practice_attendance(
  p_slot uuid, p_actor uuid, p_attended boolean, p_correction boolean, p_motivo text default null
) returns setof public.practice_slots
language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare s public.practice_slots; v_student uuid; v_role text; v_now timestamptz; v_event uuid; v_rating_cut timestamptz;
begin
  select student_id into v_student from public.practice_slots where id = p_slot;
  if v_student is not null then
    perform 1 from public.users where id = v_student for share;
    perform private.assert_student_not_deleting(v_student);
  end if;
  select rol::text into v_role from public.users where id = p_actor and activo for share;
  if v_role is null or v_role not in ('instructor', 'admin') or (not p_correction and v_role <> 'instructor') then
    raise exception 'Tu cuenta no tiene permiso para esta operación de asistencia' using errcode = 'AT403'; end if;
  select * into s from public.practice_slots where id = p_slot for update;
  if not found or (v_role = 'instructor' and s.instructor_id <> p_actor) then
    raise exception 'Franja no encontrada' using errcode = 'AT404'; end if;
  if s.student_id is distinct from v_student then
    raise exception 'La práctica cambió; vuelve a consultar' using errcode = 'CD409'; end if;
  v_now := clock_timestamp();
  if s.status <> 'completado' or s.scheduled_at + make_interval(mins => s.duration_minutes) > v_now then
    raise exception 'Solo se puede registrar asistencia de una práctica completada' using errcode = 'AT413'; end if;
  if p_attended is null then raise exception 'Indica si el alumno asistió' using errcode = '22023'; end if;
  if p_correction then
    if p_motivo is null or char_length(private.trim_attendance_reason(p_motivo)) not between 10 and 500 then
      raise exception 'El motivo debe tener entre 10 y 500 caracteres' using errcode = 'AT412'; end if;
    if v_role = 'instructor' and not private.attendance_correction_window_open(s.scheduled_at, s.duration_minutes, v_now) then
      raise exception 'Pasaron las 48 horas para corregir; solicita la corrección al administrador' using errcode = 'AT410'; end if;
    if v_role = 'instructor' and s.attended is null then
      raise exception 'La asistencia aún no está registrada; realiza primero el registro inicial' using errcode = 'AT415'; end if;
    if s.attended is not distinct from p_attended then
      raise exception 'La corrección debe cambiar el valor de asistencia' using errcode = 'AT411'; end if;
  elsif s.attended is not null then
    raise exception 'La asistencia ya fue registrada; para corregirla indica un motivo' using errcode = 'AT414';
  end if;
  insert into public.practice_attendance_events(slot_id, student_id, instructor_id, cohort_id,
    scheduled_at, duration_minutes, actor_id, actor_role, created_at, tipo, previous_attended, new_attended, motivo)
  values(s.id, s.student_id, s.instructor_id, s.cohort_id, s.scheduled_at, s.duration_minutes,
    p_actor, v_role, v_now, case when p_correction then 'correccion' else 'registro' end,
    s.attended, p_attended, case when p_correction then private.trim_attendance_reason(p_motivo) else null end) returning id into v_event;
  -- RF-04: mismo reloj que el evento auditado, nunca updated_at.
  select enabled_at into strict v_rating_cut from private.practice_rating_rollout where singleton;
  update public.practice_slots set attended = p_attended,
    rating_window_opens_at = case when p_attended
      and s.scheduled_at + make_interval(mins => s.duration_minutes) > v_rating_cut
      then greatest(s.scheduled_at + make_interval(mins => s.duration_minutes) + interval '5 minutes', v_now)
      else null::timestamptz end where id = s.id returning * into s;
  if p_correction and not p_attended then
    update public.practice_ratings set invalidated_at = v_now,
      invalidation_reason = private.trim_attendance_reason(p_motivo), invalidation_event_id = v_event
      where practice_slot_id = s.id and invalidated_at is null;
  end if;
  if p_attended and s.rating_window_opens_at is not null
    and not exists(select 1 from public.practice_ratings where practice_slot_id = s.id) then
    perform private.enqueue_practice_notification(s.student_id, 'encuesta_practica', 'Tu encuesta post-practica',
      'Puedes calificar esta practica desde cinco minutos despues de su fin y una vez registrada tu asistencia. Consulta el plazo vigente al abrir la encuesta.',
      s.id, s.scheduled_at);
  end if;
  if p_correction then perform private.enqueue_attendance_correction(v_event); end if;
  return next s;
end;
$$;

create or replace function public.delete_student_data(p_actor uuid,p_student uuid,p_version timestamptz,p_cleaned_paths text[])
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare op public.student_deletion_operations; v_role public.user_role; v_cut timestamptz;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  select rol into v_role from public.users where id=p_student for update;
  if found and v_role<>'estudiante' then raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
  select * into op from public.student_deletion_operations where student_id=p_student for update;
  if not found then raise exception 'Operación no encontrada' using errcode='CD404'; end if;
  if op.phase<>'storage' or op.updated_at is distinct from p_version then return to_jsonb(op); end if;
  if exists(select 1 from public.users where id=p_student and activo) then
    raise exception 'Primero bloquear el acceso' using errcode='CD030'; end if;
  if to_regclass('public.payments') is not null then
    raise exception 'Revisar RF-04 antes de eliminar' using errcode='0A000'; end if;
  -- FOR UPDATE del padre bloquea nuevos documentos/links por FK; después releer
  -- los documentos bajo lock incluye escrituras que ya estaban en vuelo.
  perform 1 from public.solicitudes_inscripcion where student_id=p_student order by id for update;
  perform 1 from public.solicitud_documentos where solicitud_id in
    (select id from public.solicitudes_inscripcion where student_id=p_student) order by id for update;
  if exists(select 1 from public.solicitud_documentos d join public.solicitudes_inscripcion s on s.id=d.solicitud_id
    where s.student_id=p_student and not coalesce(d.storage_path=any(p_cleaned_paths),false)) then
    raise exception 'Repetir limpieza de Storage' using errcode='CD032'; end if;
  delete from public.solicitud_documentos where solicitud_id in
    (select id from public.solicitudes_inscripcion where student_id=p_student);
  delete from public.solicitudes_inscripcion where student_id=p_student;
  delete from public.attempt_answers where attempt_id in (select id from public.exam_attempts where student_id=p_student);
  delete from public.exam_attempts where student_id=p_student;
  delete from public.practice_slot_cancellations where student_id=p_student;
  perform 1 from public.practice_slots where student_id=p_student order by id for update;
  -- RF-04: limpiar antes de las franjas/usuario; conservar guards y CAS.
  delete from public.practice_ratings where student_id=p_student;
  v_cut:=clock_timestamp();
  delete from public.practice_slots where student_id=p_student and scheduled_at<=v_cut;
  update public.practice_slots set student_id=null,status='liberado',attended=null,confirmed_at=null,
    confirmation_notified_at=null,release_notified_at=null where student_id=p_student and scheduled_at>v_cut;
  delete from public.enrollment_documents where enrollment_id in (select id from public.enrollments where student_id=p_student);
  delete from public.enrollments where student_id=p_student;
  -- Eliminar fila entera: cubre response/request_hash y request si se incorporase.
  delete from public.manual_enrollment_operations where student_id=p_student;
  delete from public.student_practice_recovery where student_id=p_student;
  delete from public.users where id=p_student;
  update public.student_deletion_operations set phase='auth',status='pendiente',data_deleted_by=p_actor,
    data_deleted_at=clock_timestamp(),updated_at=clock_timestamp() where student_id=p_student returning * into op;
  return to_jsonb(op);
end $$;

revoke all on function private.lock_rateable_practice(uuid,uuid), private.guard_practice_rating(),
  private.guard_practice_rating_window(), public.submit_practice_rating(uuid,uuid,numeric,text),
  public.list_student_pending_practice_ratings(uuid,integer,integer),
  public.list_admin_instructor_ratings(uuid,integer,integer),
  public.admin_instructor_rating_detail(uuid,uuid,integer,integer) from public, anon, authenticated;
grant execute on function private.lock_rateable_practice(uuid,uuid), private.guard_practice_rating(),
  private.guard_practice_rating_window(), public.submit_practice_rating(uuid,uuid,numeric,text),
  public.list_student_pending_practice_ratings(uuid,integer,integer),
  public.list_admin_instructor_ratings(uuid,integer,integer),
  public.admin_instructor_rating_detail(uuid,uuid,integer,integer) to service_role;

-- Corte explicito, guardado una vez al terminar la instalacion; no backfill.
insert into private.practice_rating_rollout(singleton, enabled_at) values(true, clock_timestamp());
notify pgrst, 'reload schema';
commit;
