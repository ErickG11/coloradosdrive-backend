-- RF-03 E4. Aplicacion manual despues de asistencia-e4-preflight.sql y 033.
begin;
set local lock_timeout = '5s';

-- Mismos caracteres de borde que String.trim() del contrato HTTP.
create function private.trim_attendance_reason(p_value text)
returns text language sql immutable security invoker set search_path = '' as $$
  select btrim(p_value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

create table public.practice_attendance_events (
  id uuid primary key default gen_random_uuid(),
  -- Instantaneas sin cascadas: conservar la huella aunque se elimine una cuenta.
  slot_id uuid not null,
  student_id uuid not null,
  instructor_id uuid not null,
  cohort_id uuid not null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('instructor', 'admin')),
  created_at timestamptz not null default clock_timestamp(),
  tipo text not null check (tipo in ('registro', 'correccion')),
  previous_attended boolean,
  new_attended boolean not null,
  motivo text,
  transaction_id bigint not null default txid_current(),
  constraint practice_attendance_events_change_check check (
    (tipo = 'registro' and actor_role = 'instructor' and previous_attended is null and motivo is null)
    or (tipo = 'correccion' and previous_attended is distinct from new_attended
      and motivo is not null and motivo = private.trim_attendance_reason(motivo) and char_length(motivo) between 10 and 500)
  )
);
create index practice_attendance_events_slot_idx on public.practice_attendance_events(slot_id, created_at desc, id desc);
alter table public.practice_attendance_events enable row level security;
revoke all on public.practice_attendance_events from public, anon, authenticated, service_role;
grant select, insert on public.practice_attendance_events to service_role;

create function private.reject_attendance_event_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Los eventos de asistencia son inmutables' using errcode = 'AT403';
end;
$$;
create trigger practice_attendance_events_immutable
  before update or delete on public.practice_attendance_events
  for each row execute function private.reject_attendance_event_mutation();

-- Tambien rechaza escrituras del backend anterior que no dejan auditoria.
create function private.require_attendance_event()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.attended is not null then
      raise exception 'El registro de asistencia requiere una operación auditada' using errcode = 'AT417'; end if;
    return new;
  end if;
  if new.attended is distinct from old.attended then
    if new.status <> 'completado' or new.student_id is distinct from old.student_id
      or not exists(select 1 from public.practice_attendance_events e
        where e.slot_id = old.id and e.transaction_id = txid_current()
          and e.student_id = new.student_id and e.instructor_id = new.instructor_id
          and e.cohort_id = new.cohort_id and e.scheduled_at = new.scheduled_at
          and e.duration_minutes = new.duration_minutes
          and e.previous_attended is not distinct from old.attended and e.new_attended = new.attended) then
      raise exception 'El cambio de asistencia requiere una operación auditada' using errcode = 'AT417';
    end if;
  end if;
  return new;
end;
$$;
create trigger practice_slots_attendance_audit
  before insert or update of attended on public.practice_slots
  for each row execute function private.require_attendance_event();

alter table public.notifications add column attendance_event_id uuid references public.practice_attendance_events(id);
alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check check (tipo in (
  'recordatorio_practica', 'resultado_cancelacion', 'cupo_disponible',
  'sin_practica_instructor', 'cambio_realizado', 'asistencia_corregida'));
alter table public.notifications add constraint notifications_attendance_event_check check (
  (tipo = 'asistencia_corregida' and attendance_event_id is not null and email_status is null)
  or (tipo <> 'asistencia_corregida' and attendance_event_id is null));
drop index public.notifications_automatic_unique;
create unique index notifications_automatic_unique on public.notifications(user_id, tipo, practice_slot_id)
  where practice_slot_id is not null and tipo <> 'asistencia_corregida';
create unique index notifications_attendance_event_unique on public.notifications(user_id, attendance_event_id)
  where attendance_event_id is not null;

-- Conservar la firma y ajustar la inferencia del indice parcial de E3.
create or replace function private.enqueue_practice_notification(
  p_user uuid, p_type text, p_title text, p_message text, p_slot uuid,
  p_scheduled_at timestamptz, p_email boolean default false
) returns void language sql volatile security invoker set search_path = '' as $$
  insert into public.notifications(user_id, tipo, titulo, mensaje, practice_slot_id, scheduled_at, email_status)
  select u.id, p_type, p_title, p_message, p_slot, p_scheduled_at,
    case when p_email then 'pendiente' else null end
  from public.users u where u.id = p_user and u.activo and u.rol in ('estudiante', 'instructor')
  on conflict (user_id, tipo, practice_slot_id)
    where practice_slot_id is not null and tipo <> 'asistencia_corregida' do nothing;
$$;

create function private.enqueue_attendance_correction(p_event uuid)
returns void language sql volatile security invoker set search_path = '' as $$
  insert into public.notifications(user_id, tipo, titulo, mensaje, practice_slot_id, scheduled_at, attendance_event_id)
  select e.student_id, 'asistencia_corregida', 'Se corrigió tu asistencia',
    'Tu asistencia ahora figura como ' || case when e.new_attended then 'Asistió.' else 'No asistió.' end,
    e.slot_id, e.scheduled_at, e.id
  from public.practice_attendance_events e where e.id = p_event and e.tipo = 'correccion'
  on conflict (user_id, attendance_event_id) where attendance_event_id is not null do nothing;
$$;

-- Orden compatible con eliminacion: alumno antes de franja. El actor se lee
-- de users, nunca de un rol suministrado por el cliente. Reloj despues del lock.
create function private.attendance_correction_window_open(p_start timestamptz, p_duration integer, p_now timestamptz)
returns boolean language sql stable security invoker set search_path = '' as $$
  select p_now <= p_start + make_interval(mins => p_duration) + interval '48 hours';
$$;

create function private.write_practice_attendance(
  p_slot uuid, p_actor uuid, p_attended boolean, p_correction boolean, p_motivo text default null
) returns setof public.practice_slots
language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare s public.practice_slots; v_student uuid; v_role text; v_now timestamptz; v_event uuid;
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
  update public.practice_slots set attended = p_attended where id = s.id returning * into s;
  if p_correction then perform private.enqueue_attendance_correction(v_event); end if;
  return next s;
end;
$$;

create function public.register_practice_attendance(p_slot uuid, p_actor uuid, p_attended boolean)
returns setof public.practice_slots language sql volatile security invoker set search_path = '' as $$
  select * from private.write_practice_attendance(p_slot, p_actor, p_attended, false);
$$;
create function public.correct_practice_attendance(p_slot uuid, p_actor uuid, p_attended boolean, p_motivo text)
returns setof public.practice_slots language sql volatile security invoker set search_path = '' as $$
  select * from private.write_practice_attendance(p_slot, p_actor, p_attended, true, p_motivo);
$$;

create function public.list_practice_attendance_events(p_actor uuid, p_slot uuid, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_items jsonb; v_total bigint;
begin
  if not exists(select 1 from public.users where id = p_actor and activo and rol = 'admin') then
    raise exception 'Solo el administrador puede consultar la auditoría' using errcode = 'AT403'; end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Paginación inválida' using errcode = '22023'; end if;
  if not exists(select 1 from public.practice_slots where id = p_slot)
    and not exists(select 1 from public.practice_attendance_events where slot_id = p_slot) then
    raise exception 'Franja no encontrada' using errcode = 'AT404'; end if;
  select count(*) into v_total from public.practice_attendance_events where slot_id = p_slot;
  select coalesce(jsonb_agg(to_jsonb(e) - 'transaction_id' order by e.created_at desc, e.id desc), '[]'::jsonb) into v_items
    from (select * from public.practice_attendance_events where slot_id = p_slot
      order by created_at desc, id desc limit p_page_size offset (p_page - 1) * p_page_size) e;
  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

create function public.student_practice_history(p_student uuid, p_enrollment uuid, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare e public.enrollments; v_result jsonb;
begin
  if not exists(select 1 from public.users where id = p_student and activo and rol = 'estudiante') then
    raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'AT403'; end if;
  select * into e from public.enrollments where id = p_enrollment and student_id = p_student;
  if not found then raise exception 'Matrícula no encontrada' using errcode = 'CD404'; end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Paginación inválida' using errcode = '22023'; end if;
  -- practice_slots no tiene enrollment_id. No duplicar horas si existen
  -- varias matriculas historicas del mismo alumno en una misma cohorte.
  if e.cohort_id is not null and exists(select 1 from public.enrollments other
    where other.student_id = p_student and other.cohort_id = e.cohort_id and other.id <> e.id) then
    raise exception 'Hay varias matrículas en la misma cohorte; el historial requiere revisión administrativa' using errcode = 'CD409'; end if;
  with practices as (
    select 'practice:' || s.id::text as id, s.id as slot_id, null::uuid as cancellation_id,
      s.scheduled_at, s.duration_minutes, s.status::text as slot_status, s.attended,
      case when s.status = 'completado' and s.attended then 'asistio'
        when s.status = 'completado' and s.attended = false then 'no_asistio' else 'pendiente' end as estado,
      null::text as resultado, null::text as motivo,
      case when s.status = 'completado' and s.attended then s.duration_minutes else 0 end as attended_minutes,
      case when s.status = 'completado' and s.attended = false then s.duration_minutes else 0 end as lost_minutes
    from public.practice_slots s where s.student_id = p_student and s.cohort_id = e.cohort_id
    union all
    select 'cancellation:' || c.id::text, c.slot_id, c.id, c.slot_starts_at, 60, null::text, null::boolean,
      case when c.resultado = 'falta' then 'falta'
        when c.resultado = 'reprogramable' and c.repuesto_en is null then 'liberada' else 'cancelada' end,
      c.resultado, c.motivo_texto, 0, case when c.resultado in ('hora_perdida', 'falta') then 60 else 0 end
    from public.practice_slot_cancellations c where c.enrollment_id = e.id and c.student_id = p_student
    union all
    select 'recovery:' || r.slot_id::text, r.slot_id, null::uuid, r.scheduled_at, null::integer,
      null::text, null::boolean, 'liberada', null::text, r.reason, 0, 0
    from public.student_practice_recovery r where r.student_id = p_student and r.cohort_id = e.cohort_id
      and r.status in ('cancelada_por_desactivacion', 'pendiente_reprogramar')
      and not exists(select 1 from public.practice_slots s where s.id = r.slot_id and s.student_id = p_student
        and s.cohort_id = r.cohort_id and s.scheduled_at = r.scheduled_at and s.instructor_id = r.instructor_id)
      and not exists(select 1 from public.practice_slot_cancellations c where c.student_id = p_student
        and c.enrollment_id = e.id and c.slot_id = r.slot_id and c.slot_starts_at = r.scheduled_at)
  ), items as (
    select * from practices order by scheduled_at desc, id desc limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object('items', (select coalesce(jsonb_agg(to_jsonb(i) - 'attended_minutes' - 'lost_minutes'
      order by i.scheduled_at desc, i.id desc), '[]'::jsonb) from items i),
    'total', count(*), 'summary', jsonb_build_object(
      'horasAsistidas', round(coalesce(sum(attended_minutes), 0) / 60.0, 2),
      'horasObjetivo', e.horas_practica_objetivo,
      'horasPerdidas', round(coalesce(sum(lost_minutes), 0) / 60.0, 2))) into v_result from practices;
  return v_result;
end;
$$;

revoke all on function private.reject_attendance_event_mutation(), private.require_attendance_event(),
  private.trim_attendance_reason(text),
  private.attendance_correction_window_open(timestamptz,integer,timestamptz),
  private.enqueue_attendance_correction(uuid), private.write_practice_attendance(uuid,uuid,boolean,boolean,text),
  public.register_practice_attendance(uuid,uuid,boolean), public.correct_practice_attendance(uuid,uuid,boolean,text),
  public.list_practice_attendance_events(uuid,uuid,integer,integer),
  public.student_practice_history(uuid,uuid,integer,integer) from public, anon, authenticated;
grant execute on function private.reject_attendance_event_mutation(), private.require_attendance_event(),
  private.trim_attendance_reason(text),
  private.attendance_correction_window_open(timestamptz,integer,timestamptz),
  private.enqueue_attendance_correction(uuid), private.write_practice_attendance(uuid,uuid,boolean,boolean,text),
  public.register_practice_attendance(uuid,uuid,boolean), public.correct_practice_attendance(uuid,uuid,boolean,text),
  public.list_practice_attendance_events(uuid,uuid,integer,integer),
  public.student_practice_history(uuid,uuid,integer,integer) to service_role;
commit;
