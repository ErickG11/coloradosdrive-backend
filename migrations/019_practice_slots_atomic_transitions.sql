-- CD-07. Aplicar después de 018. RPC privadas del backend (service_role).
begin;
set local lock_timeout = '5s';

do $$
begin
  if (select count(*) from pg_constraint
      where conrelid = 'public.practice_slots'::regclass and convalidated
        and conname in ('practice_slots_duration_60', 'practice_slots_finite_start',
                        'practice_slots_instructor_interval_excl')) <> 3 then
    raise exception using errcode = 'CD007', message = 'CD-07: se requiere la migración 018 completa antes de 019';
  end if;
end;
$$;

-- Estas dos funciones existentes se cualifican para que los UPDATE de las RPC
-- con search_path vacío sigan ejecutando los triggers de rol de 005.
create or replace function public.enforce_practice_slot_instructor_role()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare instructor_role public.user_role;
begin
  select rol into instructor_role from public.users where id = new.instructor_id;
  if instructor_role is distinct from 'instructor' then
    raise exception 'practice_slots.instructor_id (%) must reference a user with rol = instructor', new.instructor_id;
  end if;
  return new;
end;
$$;
create or replace function public.enforce_practice_slot_student_role()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare student_role public.user_role;
begin
  if new.student_id is null then return new; end if;
  select rol into student_role from public.users where id = new.student_id;
  if student_role is distinct from 'estudiante' then
    raise exception 'practice_slots.student_id (%) must reference a user with rol = estudiante', new.student_id;
  end if;
  return new;
end;
$$;

-- Puro y comprobable con tiempos fijos; ninguna RPC de escritura admite p_now.
create function public.practice_slot_window_open(p_start timestamptz, p_now timestamptz)
returns boolean language sql immutable strict security invoker set search_path = '' as $$
  select (p_now at time zone 'UTC') < (p_start at time zone 'UTC') - interval '5 minutes';
$$;

create function public.practice_slot_transition_due(
  p_slot public.practice_slots, p_transition text, p_now timestamptz
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case p_transition
    when 'remind' then (p_slot).status = 'asignado' and (p_slot).confirmation_notified_at is null
      and p_now >= (p_slot).scheduled_at - interval '20 minutes'
      and public.practice_slot_window_open((p_slot).scheduled_at, p_now)
    when 'close' then (p_slot).status in ('disponible', 'asignado', 'liberado')
      and not public.practice_slot_window_open((p_slot).scheduled_at, p_now)
    when 'complete' then (p_slot).status = 'confirmado'
      and p_now >= (p_slot).scheduled_at + interval '60 minutes'
    else false
  end;
$$;

create function public.act_on_practice_slot(p_slot_id uuid, p_student_id uuid, p_action text)
returns setof public.practice_slots
language plpgsql volatile security invoker set search_path = '' as $$
declare current_slot public.practice_slots; changed_slot public.practice_slots;
begin
  if p_action is null or p_action not in ('claim', 'confirm', 'cancel') then
    raise exception using errcode = '22023', message = 'Acción de práctica inválida';
  end if;
  select s.* into current_slot from public.practice_slots s where s.id = p_slot_id for update;
  if not found then
    raise exception using errcode = 'CD404', message = 'Franja no encontrada';
  end if;

  if p_action = 'claim' then
    -- Mantener elegibilidad vigente mientras se escribe (bloqueo compartido).
    perform 1 from public.enrollments e where e.student_id = p_student_id
      and e.cohort_id = current_slot.cohort_id and e.status = 'activo' for share;
    if not found then
      raise exception using errcode = 'CD403',
        message = 'No tienes una inscripción activa en la cohorte de esta franja';
    end if;
    if current_slot.status not in ('disponible', 'liberado') then
      raise exception using errcode = 'CD409', message = 'Esta franja ya no está disponible';
    end if;
    update public.practice_slots s set student_id = p_student_id, status = 'asignado',
      confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
    where s.id = p_slot_id and s.status in ('disponible', 'liberado')
      and s.cohort_id = current_slot.cohort_id
      and public.practice_slot_window_open(s.scheduled_at, clock_timestamp())
    returning s.* into changed_slot;
    if not found then
      raise exception using errcode = 'CD409', message = 'La ventana de reclamación ya cerró';
    end if;
  else
    if current_slot.student_id is distinct from p_student_id then
      raise exception using errcode = 'CD404', message = 'Franja no encontrada';
    end if;
    if p_action = 'confirm' then
      if current_slot.status <> 'asignado' then
        raise exception using errcode = 'CD409', message = 'Este turno no está pendiente de confirmación';
      end if;
      update public.practice_slots s set status = 'confirmado', confirmed_at = clock_timestamp()
      where s.id = p_slot_id and s.student_id = p_student_id and s.status = 'asignado'
        and public.practice_slot_window_open(s.scheduled_at, clock_timestamp())
      returning s.* into changed_slot;
      if not found then
        raise exception using errcode = 'CD409', message = 'La ventana de confirmación ya cerró';
      end if;
    else
      if current_slot.status not in ('asignado', 'confirmado') then
        raise exception using errcode = 'CD409', message = 'Este turno no se puede cancelar';
      end if;
      -- No hay un límite temporal nuevo para cancelar.
      update public.practice_slots s set student_id = null, status = 'liberado',
        confirmed_at = null, confirmation_notified_at = null, release_notified_at = clock_timestamp()
      where s.id = p_slot_id and s.student_id = p_student_id and s.status in ('asignado', 'confirmado')
      returning s.* into changed_slot;
      if not found then
        raise exception using errcode = 'CD409', message = 'Este turno no se puede cancelar';
      end if;
    end if;
  end if;
  return next changed_slot;
end;
$$;

create function public.practice_slots_scheduler_candidates(p_transition text)
returns table(slot jsonb, row_version text)
language sql volatile security invoker set search_path = '' as $$
  select to_jsonb(s), s.xmin::text from public.practice_slots s
  where public.practice_slot_transition_due(s, p_transition, clock_timestamp())
  order by s.scheduled_at, s.id;
$$;

create function public.transition_practice_slot_for_scheduler(
  p_slot_id uuid, p_transition text, p_expected_version text
)
returns setof public.practice_slots
language plpgsql volatile security invoker set search_path = '' as $$
declare current_slot public.practice_slots; current_version text;
begin
  select s.* into current_slot
    from public.practice_slots s where s.id = p_slot_id for update;
  if not found then return; end if;
  select s.xmin::text into current_version from public.practice_slots s where s.id = p_slot_id;
  if current_version is distinct from p_expected_version then return; end if;
  -- Repetir versión, estado y tiempo EN la escritura, después de adquirir el lock.
  -- Si perdió la carrera devuelve cero filas: no hay efectos secundarios.
  if p_transition = 'remind' then
    return query update public.practice_slots s set confirmation_notified_at = clock_timestamp()
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status = 'asignado' and s.student_id = current_slot.student_id
      and s.confirmation_notified_at is null
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  elsif p_transition = 'close' then
    return query update public.practice_slots s set status = 'sin_practica', student_id = null,
      confirmed_at = null, confirmation_notified_at = null
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status = current_slot.status and s.student_id is not distinct from current_slot.student_id
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  elsif p_transition = 'complete' then
    return query update public.practice_slots s set status = 'completado'
    where s.id = p_slot_id and s.xmin::text = p_expected_version and s.status = 'confirmado'
      and s.student_id = current_slot.student_id
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  end if;
end;
$$;

revoke all on function public.practice_slot_window_open(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.practice_slot_transition_due(public.practice_slots, text, timestamptz) from public, anon, authenticated;
revoke all on function public.act_on_practice_slot(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.practice_slots_scheduler_candidates(text) from public, anon, authenticated;
revoke all on function public.transition_practice_slot_for_scheduler(uuid, text, text) from public, anon, authenticated;
grant execute on function public.practice_slot_window_open(timestamptz, timestamptz) to service_role;
grant execute on function public.practice_slot_transition_due(public.practice_slots, text, timestamptz) to service_role;
grant execute on function public.act_on_practice_slot(uuid, uuid, text) to service_role;
grant execute on function public.practice_slots_scheduler_candidates(text) to service_role;
grant execute on function public.transition_practice_slot_for_scheduler(uuid, text, text) to service_role;
notify pgrst, 'reload schema';
commit;
