-- RF-03 E3. Aplicacion manual tras asistencia-e3-preflight.sql.
begin;
set local lock_timeout = '5s';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tipo text not null check (tipo in ('recordatorio_practica', 'resultado_cancelacion',
    'cupo_disponible', 'sin_practica_instructor', 'cambio_realizado')),
  titulo text not null,
  mensaje text not null,
  -- Instantaneas: conservar el aviso aunque la franja sea eliminada.
  practice_slot_id uuid,
  scheduled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  -- NULL significa aviso solo en bandeja; no se intenta enviar un correo.
  email_status text check (email_status in ('pendiente', 'enviado', 'fallido')),
  email_attempts smallint not null default 0 check (email_attempts between 0 and 3),
  email_last_error text,
  email_next_attempt_at timestamptz not null default clock_timestamp(),
  email_lease_token uuid,
  email_locked_until timestamptz,
  check ((email_lease_token is null) = (email_locked_until is null))
);
create unique index notifications_automatic_unique
  on public.notifications(user_id, tipo, practice_slot_id) where practice_slot_id is not null;
create index notifications_user_created_idx on public.notifications(user_id, created_at desc, id desc);
create index notifications_email_pending_idx on public.notifications(email_next_attempt_at)
  where email_status = 'pendiente';
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated, service_role;
grant select, insert, delete on public.notifications to service_role;
grant update(read_at, email_status, email_attempts, email_last_error, email_next_attempt_at,
  email_lease_token, email_locked_until) on public.notifications to service_role;

create function private.enqueue_practice_notification(
  p_user uuid, p_type text, p_title text, p_message text, p_slot uuid,
  p_scheduled_at timestamptz, p_email boolean default false
) returns void language sql volatile security invoker set search_path = '' as $$
  insert into public.notifications(user_id, tipo, titulo, mensaje, practice_slot_id, scheduled_at, email_status)
  select u.id, p_type, p_title, p_message, p_slot, p_scheduled_at,
    case when p_email then 'pendiente' else null end
  from public.users u where u.id = p_user and u.activo and u.rol in ('estudiante', 'instructor')
  on conflict (user_id, tipo, practice_slot_id) where practice_slot_id is not null do nothing;
$$;

create function private.notify_eligible_released_slot(p_slot public.practice_slots)
returns void language plpgsql volatile security invoker set search_path = '' as $$
declare e record;
begin
  if not public.practice_slot_window_open(p_slot.scheduled_at, clock_timestamp()) then return; end if;
  for e in select id, student_id from public.enrollments where cohort_id = p_slot.cohort_id and status = 'activo' loop
    begin
      if exists(select 1 from private.eligible_practice_slot_changes(e.id) c where (c.slot).id = p_slot.id) then
        perform private.enqueue_practice_notification(e.student_id, 'cupo_disponible', 'Hay un cupo disponible',
          'Puedes revisar este horario en Asistencia. La disponibilidad se comprueba al tomarlo.',
          p_slot.id, p_slot.scheduled_at);
      end if;
    exception when sqlstate 'CD409' then
      -- Un plan invalido no hace elegible al destinatario ni bloquea la cancelacion ajena.
      null;
    end;
  end loop;
end;
$$;

create function private.assert_notification_owner(p_user uuid)
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.users where id = p_user and activo and rol in ('estudiante', 'instructor')) then
    raise exception 'Cuenta inactiva o sin acceso a notificaciones' using errcode = 'CD403'; end if;
end;
$$;

create function public.list_user_notifications(p_user uuid, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_items jsonb; v_total bigint; v_unread bigint;
begin
  perform private.assert_notification_owner(p_user);
  if p_page is null or p_page < 1 or p_page > 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Paginacion invalida' using errcode = '22023'; end if;
  select count(*), count(*) filter(where read_at is null) into v_total, v_unread
    from public.notifications where user_id = p_user;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc, n.id desc), '[]'::jsonb) into v_items
    from (select * from public.notifications where user_id = p_user order by created_at desc, id desc
      limit p_page_size offset (p_page - 1) * p_page_size) n;
  return jsonb_build_object('items', v_items, 'total', v_total, 'unreadCount', v_unread);
end;
$$;

create function public.mark_user_notification_read(p_user uuid, p_id uuid)
returns setof public.notifications language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform private.assert_notification_owner(p_user);
  return query update public.notifications set read_at = coalesce(read_at, clock_timestamp())
    where id = p_id and user_id = p_user returning *;
end;
$$;

create function public.read_all_user_notifications(p_user uuid)
returns integer language plpgsql volatile security invoker set search_path = '' as $$
declare v_count integer;
begin
  perform private.assert_notification_owner(p_user);
  update public.notifications set read_at = clock_timestamp() where user_id = p_user and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Una concesion por correo evita envios simultaneos entre procesos del cron.
create function public.claim_notification_email()
returns setof public.notifications language plpgsql volatile security invoker set search_path = '' as $$
declare v_id uuid; v_now timestamptz := clock_timestamp();
begin
  update public.notifications n set email_status = 'fallido', email_lease_token = null, email_locked_until = null,
    email_last_error = case when n.email_attempts >= 3 then 'No se pudo confirmar el envio tras tres intentos'
      when n.tipo = 'recordatorio_practica' and n.scheduled_at <= v_now then 'La práctica ya comenzó; no se envía un recordatorio tardío'
      when n.tipo = 'recordatorio_practica' and not exists(select 1 from public.practice_slots s
        where s.id=n.practice_slot_id and s.student_id=n.user_id and s.scheduled_at=n.scheduled_at
          and s.status in ('asignado','confirmado')) then 'La práctica cambió o ya no está asignada al destinatario'
      else 'Destinatario inactivo o inexistente' end
    where n.email_status = 'pendiente' and (n.email_locked_until is null or n.email_locked_until <= v_now)
      and (n.email_attempts >= 3 or (n.tipo = 'recordatorio_practica' and (n.scheduled_at <= v_now
        or not exists(select 1 from public.practice_slots s where s.id=n.practice_slot_id
          and s.student_id=n.user_id and s.scheduled_at=n.scheduled_at and s.status in ('asignado','confirmado'))))
        or not exists(select 1 from public.users u where u.id = n.user_id and u.activo));
  select n.id into v_id from public.notifications n
    where n.email_status = 'pendiente' and n.email_attempts < 3 and n.email_next_attempt_at <= v_now
      and (n.email_locked_until is null or n.email_locked_until <= v_now)
    order by n.email_next_attempt_at, n.id for update skip locked limit 1;
  if not found then return; end if;
  return query update public.notifications set email_attempts = email_attempts + 1,
    email_lease_token = gen_random_uuid(), email_locked_until = v_now + interval '2 minutes'
    where id = v_id returning *;
end;
$$;

create function public.finish_notification_email(p_id uuid, p_token uuid, p_error text default null)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  update public.notifications set email_status = case when p_error is null then 'enviado'
      when email_attempts >= 3 then 'fallido' else 'pendiente' end,
    email_last_error = left(p_error, 1000), email_next_attempt_at = clock_timestamp() + interval '1 minute',
    email_lease_token = null, email_locked_until = null
    where id = p_id and email_lease_token = p_token and email_status = 'pendiente';
  return found;
end;
$$;

revoke all on function private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean),
  private.notify_eligible_released_slot(public.practice_slots), private.assert_notification_owner(uuid),
  public.list_user_notifications(uuid,integer,integer), public.mark_user_notification_read(uuid,uuid),
  public.read_all_user_notifications(uuid), public.claim_notification_email(),
  public.finish_notification_email(uuid,uuid,text) from public, anon, authenticated;
grant execute on function private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean),
  private.notify_eligible_released_slot(public.practice_slots), private.assert_notification_owner(uuid),
  public.list_user_notifications(uuid,integer,integer), public.mark_user_notification_read(uuid,uuid),
  public.read_all_user_notifications(uuid), public.claim_notification_email(),
  public.finish_notification_email(uuid,uuid,text) to service_role;

-- Los reemplazos de las RPC E1/E2 y del scheduler se incluyen a continuacion.

create or replace function public.cancel_practice_slot_with_reason(
  p_slot_id uuid, p_student_id uuid, p_motivo_categoria text, p_motivo_texto text
) returns jsonb language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare s public.practice_slots; e public.enrollments; v_now timestamptz;
  v_free boolean; v_result text; v_number smallint; v_id uuid; v_broadcast boolean;
begin
  if p_motivo_categoria is null or p_motivo_categoria not in
      ('salud', 'trabajo', 'estudios', 'familiar', 'transporte', 'otro')
    or p_motivo_texto is null or char_length(btrim(p_motivo_texto)) < 10 then
    raise exception 'Indica una categoría válida y un motivo de al menos 10 caracteres'
      using errcode = '22023'; end if;
  -- Mismo orden que acceso/eliminación: alumno, matrícula y después franja.
  -- FOR SHARE conserva activo mientras se cancela; permite concurrencia de dos cancelaciones.
  perform 1 from public.users where id = p_student_id and rol = 'estudiante' and activo for share;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  perform private.assert_student_not_deleting(p_student_id);
  select * into s from public.practice_slots where id = p_slot_id and student_id = p_student_id;
  if not found then raise exception 'Franja no encontrada' using errcode = 'CD404'; end if;
  select * into e from public.enrollments where student_id = p_student_id
    and cohort_id = s.cohort_id and status = 'activo' for update;
  if not found then raise exception 'No hay matrícula activa para esta práctica' using errcode = 'CD409'; end if;
  select * into s from public.practice_slots where id = p_slot_id and student_id = p_student_id for update;
  if not found then raise exception 'Franja no encontrada' using errcode = 'CD404'; end if;
  -- El reloj se consulta después de esperar todos los bloqueos.
  v_now := clock_timestamp();
  if s.status not in ('asignado', 'confirmado') or s.scheduled_at <= v_now then
    raise exception 'Solo se puede cancelar una práctica antes de su inicio' using errcode = 'CD409'; end if;
  if s.cohort_id is distinct from e.cohort_id then
    raise exception 'La práctica cambió; vuelve a consultar' using errcode = 'CD409'; end if;
  select exists(select 1 from private.eligible_free_slots_for_enrollment(e.id, s.id)) into v_free;
  v_now := clock_timestamp();
  if s.scheduled_at <= v_now then
    raise exception 'Solo se puede cancelar una práctica antes de su inicio' using errcode = 'CD409'; end if;
  if e.reprogramaciones_usadas >= 2 then v_result := 'falta';
  elsif v_free then
    v_result := 'reprogramable';
    update public.enrollments set reprogramaciones_usadas = reprogramaciones_usadas + 1
      where id = e.id returning reprogramaciones_usadas into v_number;
  else v_result := 'hora_perdida';
  end if;
  v_broadcast := public.practice_slot_window_open(s.scheduled_at, v_now);
  insert into public.practice_slot_cancellations(slot_id, enrollment_id, student_id, instructor_id,
    cohort_id, slot_starts_at, cancelled_at, motivo_categoria, motivo_texto, resultado,
    consumio_reprogramacion, reprogramacion_numero)
    values(s.id, e.id, p_student_id, s.instructor_id, s.cohort_id, s.scheduled_at, v_now,
      p_motivo_categoria, btrim(p_motivo_texto), v_result, v_result = 'reprogramable', v_number)
    returning id into v_id;
  update public.practice_slots set student_id = null,
    status = case when v_broadcast then 'liberado'::public.practice_slot_status else 'sin_practica'::public.practice_slot_status end,
    confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
    where id = s.id returning * into s;
  perform private.enqueue_practice_notification(p_student_id, 'resultado_cancelacion', 'Aviso de inasistencia registrado',
    case v_result when 'reprogramable' then 'Puedes reponer esta hora con otro cupo elegible.'
      when 'hora_perdida' then 'Esta hora se pierde: no había otro horario elegible al avisar.'
      else 'La práctica queda como falta porque agotaste tus reprogramaciones.' end,
    s.id, s.scheduled_at);
  if v_broadcast then
    perform private.notify_eligible_released_slot(s);
  else
    perform private.enqueue_practice_notification(s.instructor_id, 'sin_practica_instructor', 'No habrá práctica en este bloque',
      'El alumno avisó que no asistirá y este bloque queda sin práctica.', s.id, s.scheduled_at, true);
  end if;
  return jsonb_build_object('slot', to_jsonb(s), 'cancellationId', v_id, 'enrollmentId', e.id,
    'studentId', p_student_id, 'instructorId', s.instructor_id, 'cohortId', s.cohort_id,
    'cancelledAt', v_now, 'resultado', v_result, 'consumioReprogramacion', v_number is not null,
    'reprogramacionNumero', v_number, 'reprogramacionesRestantes', 2 - coalesce(v_number, e.reprogramaciones_usadas),
    'difundirCohorte', v_broadcast);
end;
$$;

create or replace function public.swap_practice_slot(p_slot_id uuid, p_student_id uuid, p_source_slot_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare target public.practice_slots; source public.practice_slots; e public.enrollments;
  b record; candidate record; v_cancel uuid; v_now timestamptz; v_number smallint;
begin
  -- Orden común con E1/eliminación: alumno -> matrícula -> franjas por UUID.
  -- UPDATE del alumno serializa también cambios en otras matrículas del mismo alumno.
  perform 1 from public.users where id = p_student_id and rol = 'estudiante' and activo for update;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  perform private.assert_student_not_deleting(p_student_id);
  select * into target from public.practice_slots where id = p_slot_id;
  if not found then raise exception 'Cupo no encontrado' using errcode = 'CD404'; end if;
  select * into e from public.enrollments where student_id = p_student_id
    and cohort_id = target.cohort_id and status = 'activo' for update;
  if not found then raise exception 'No tienes matrícula activa en la cohorte de este cupo' using errcode = 'CD403'; end if;
  if p_source_slot_id is not null and not exists(select 1 from private.pending_practice_slots(e.id) where id = p_source_slot_id) then
    raise exception 'La práctica a soltar no es una práctica futura propia de esta matrícula' using errcode = 'CD409'; end if;
  perform 1 from public.practice_slots where id = p_slot_id or id = p_source_slot_id order by id for update;
  select * into target from public.practice_slots where id = p_slot_id;
  if not found or target.status not in ('disponible', 'liberado') or target.student_id is not null then
    raise exception 'Otro alumno tomó este cupo o ya no está disponible' using errcode = 'CD409'; end if;
  if target.cohort_id is distinct from e.cohort_id then
    raise exception 'El cupo cambió; vuelve a consultar' using errcode = 'CD409'; end if;
  -- Conserva activo al instructor hasta el commit; el helper E1 también lo valida.
  if exists(select 1 from public.practice_slot_cancellations c
      where c.student_id = p_student_id and c.slot_id = target.id) then
    raise exception 'No puedes volver a tomar una práctica que tú mismo soltaste' using errcode = 'CD409'; end if;
  perform 1 from public.users where id = target.instructor_id and rol = 'instructor' and activo for share;
  if not found then raise exception 'El instructor está inactivo' using errcode = 'CD023'; end if;
  select * into b from private.practice_replacement_balance(e.id);
  if b.reposiciones_pendientes > 0 and p_source_slot_id is not null then
    raise exception 'Tienes una hora pendiente por reponer: no debes soltar otra práctica' using errcode = '22023';
  elsif b.reposiciones_pendientes = 0 then
    if e.reprogramaciones_usadas >= 2 then
      raise exception 'Ya usaste tus 2 reprogramaciones; no puedes cambiar otra práctica' using errcode = 'CD409'; end if;
    if p_source_slot_id is null then
      raise exception 'Debes elegir la práctica pendiente que vas a soltar' using errcode = '22023'; end if;
  end if;
  select * into candidate from private.eligible_practice_slot_changes(e.id) c where (c.slot).id = p_slot_id;
  if not found or (candidate.caso = 'B' and not p_source_slot_id = any(candidate.source_slot_ids)) then
    raise exception 'Este cupo no es elegible: revisa horario, modalidad, fecha fin y horas del día' using errcode = 'CD409'; end if;
  v_now := clock_timestamp();
  if not public.practice_slot_window_open(target.scheduled_at, v_now) then
    raise exception 'Faltan 5 minutos o menos: el cupo ya cerró' using errcode = 'CD409'; end if;
  if candidate.caso = 'B' then
    select * into source from private.pending_practice_slots(e.id) where id = p_source_slot_id;
    if not found then raise exception 'La práctica que ibas a soltar ya empezó o cambió' using errcode = 'CD409'; end if;
    update public.enrollments set reprogramaciones_usadas = reprogramaciones_usadas + 1
      where id = e.id returning reprogramaciones_usadas into v_number;
    insert into public.practice_slot_cancellations(slot_id, enrollment_id, student_id, instructor_id,
      cohort_id, slot_starts_at, cancelled_at, motivo_categoria, motivo_texto, resultado,
      consumio_reprogramacion, reprogramacion_numero, origen, repuesto_por_slot_id, repuesto_en)
      values(source.id, e.id, p_student_id, source.instructor_id, source.cohort_id, source.scheduled_at,
        v_now, 'otro', 'Cambio de práctica por cupo disponible', 'reprogramable', true, v_number,
        'cambio_cupo', target.id, v_now) returning id into v_cancel;
    -- Primero libera el origen: evita la exclusión GiST si se superponen origen y destino.
    update public.practice_slots set student_id = null, status = 'liberado', attended = null,
      confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
      where id = source.id and student_id = p_student_id and status in ('asignado', 'confirmado')
        and scheduled_at > clock_timestamp();
    if not found then raise exception 'La práctica que ibas a soltar ya empezó o cambió' using errcode = 'CD409'; end if;
  else
    select c.id into v_cancel from public.practice_slot_cancellations c
      where c.enrollment_id = e.id and c.resultado = 'reprogramable' and c.origen = 'alumno' and c.repuesto_en is null
      order by c.cancelled_at, c.id limit 1 for update;
    if not found then raise exception 'La reposición ya fue utilizada; vuelve a consultar' using errcode = 'CD409'; end if;
    update public.practice_slot_cancellations set repuesto_por_slot_id = target.id, repuesto_en = v_now where id = v_cancel;
  end if;
  update public.practice_slots set student_id = p_student_id, status = 'asignado', attended = null,
    confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
    where id = target.id and student_id is null and status in ('disponible', 'liberado')
      and public.practice_slot_window_open(scheduled_at, clock_timestamp()) returning * into target;
  if not found then
    -- También revierte contador/historial/origen si se cruzó T-5 DURANTE la escritura.
    raise exception 'Faltan 5 minutos o menos: el cupo ya cerró' using errcode = 'CD409'; end if;
  perform private.enqueue_practice_notification(p_student_id, 'cambio_realizado', 'Cambiaste tu horario',
    case candidate.caso when 'A' then 'Repusiste una hora pendiente sin usar otra reprogramación.'
      else 'Tomaste este horario y soltaste tu práctica anterior.' end, target.id, target.scheduled_at);
  return jsonb_build_object('slot', to_jsonb(target), 'caso', candidate.caso,
    'practicaSoltadaId', p_source_slot_id, 'cancellationId', v_cancel, 'enrollmentId', e.id,
    'reprogramacionesRestantes', 2 - coalesce(v_number, e.reprogramaciones_usadas));
end;
$$;

create or replace function public.practice_slot_transition_due(
  p_slot public.practice_slots, p_transition text, p_now timestamptz
) returns boolean language sql stable security invoker set search_path = '' as $$
  select case p_transition
    when 'remind' then (p_slot).status in ('asignado', 'confirmado') and (p_slot).confirmation_notified_at is null
      and p_now >= (p_slot).scheduled_at - interval '20 minutes'
      and p_now < (p_slot).scheduled_at
    when 'close' then (p_slot).status = 'liberado'
      and not public.practice_slot_window_open((p_slot).scheduled_at, p_now)
    when 'complete' then (p_slot).status in ('asignado', 'confirmado')
      and p_now >= (p_slot).scheduled_at + interval '60 minutes'
    else false end;
$$;

create or replace function public.transition_practice_slot_for_scheduler(
  p_slot_id uuid, p_transition text, p_expected_version text
) returns setof public.practice_slots language plpgsql volatile security invoker set search_path = '' as $$
declare current_slot public.practice_slots; current_version text;
begin
  select s.* into current_slot from public.practice_slots s where s.id = p_slot_id for update;
  if not found then return; end if;
  select s.xmin::text into current_version from public.practice_slots s where s.id = p_slot_id;
  if current_version is distinct from p_expected_version then return; end if;
  if p_transition = 'remind' then
    return query update public.practice_slots s set confirmation_notified_at = clock_timestamp()
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status in ('asignado', 'confirmado') and s.student_id = current_slot.student_id
      and s.confirmation_notified_at is null
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
    if found and current_slot.student_id is not null then
      perform private.enqueue_practice_notification(current_slot.student_id, 'recordatorio_practica', 'Tu práctica comienza pronto',
        'Confirmar es opcional. Si no respondes, tu práctica se mantiene programada.',
        current_slot.id, current_slot.scheduled_at, true);
    end if;
  elsif p_transition = 'close' then
    return query update public.practice_slots s set status = 'sin_practica', student_id = null,
      confirmed_at = null, confirmation_notified_at = null
    where s.id = p_slot_id and s.xmin::text = p_expected_version and s.status = 'liberado'
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
    if found then
      perform private.enqueue_practice_notification(current_slot.instructor_id, 'sin_practica_instructor', 'No habrá práctica en este bloque',
        'El cupo liberado sigue vacío y este bloque queda sin práctica.',
        current_slot.id, current_slot.scheduled_at, true);
    end if;
  elsif p_transition = 'complete' then
    return query update public.practice_slots s set status = 'completado'
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status in ('asignado', 'confirmado') and s.student_id = current_slot.student_id
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
