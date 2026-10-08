begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog, public, extensions, pg_temp;

-- status describe únicamente el ciclo del estudiante.
alter table public.users add column activo boolean not null default true;

-- Serializa desactivación y nuevas asignaciones mediante el lock de users.
create or replace function public.enforce_practice_slot_instructor_role()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  instructor_role public.user_role;
  instructor_active boolean;
begin
  if TG_OP = 'UPDATE' then
    if new.instructor_id is not distinct from old.instructor_id then
      return new;
    end if;
  end if;
  select rol, activo into instructor_role, instructor_active
  from public.users where id = new.instructor_id for share;

  if instructor_role is distinct from 'instructor' then
    raise exception 'practice_slots.instructor_id (%) must reference a user with rol = instructor', new.instructor_id;
  end if;
  if not instructor_active then
    raise exception using errcode = 'CD023', message = 'El instructor está inactivo';
  end if;
  return new;
end;
$$;

-- El trigger original es BEFORE INSERT OR UPDATE OF instructor_id. Las
-- transiciones del scheduler y de act_on_practice_slot no cambian esa columna.
-- Si UPDATE la incluye con el mismo valor, la función permite conservarla.

create or replace function public.practice_free_instructors(
  p_scheduled_ats timestamptz[], p_instructor_id uuid default null
)
returns table(id uuid, nombre_completo text)
language sql stable security invoker set search_path = ''
as $$
  select u.id, u.nombre_completo::text from public.users u
  where u.rol = 'instructor' and u.activo
    and (p_instructor_id is null or u.id = p_instructor_id)
    and cardinality(p_scheduled_ats) > 0
    and not exists (
      select 1 from public.practice_slots s cross join unnest(p_scheduled_ats) requested(start_at)
      where s.instructor_id = u.id
        and s.status in ('disponible', 'asignado', 'confirmado', 'liberado', 'completado')
        and tsrange(s.scheduled_at at time zone 'UTC',
                    (s.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
         && tsrange(requested.start_at at time zone 'UTC',
                    (requested.start_at at time zone 'UTC') + interval '60 minutes', '[)')
    )
  order by u.nombre_completo, u.id;
$$;
revoke all on function public.practice_free_instructors(timestamptz[], uuid) from public, anon, authenticated;
grant execute on function public.practice_free_instructors(timestamptz[], uuid) to service_role;

-- Una franja disponible creada antes de desactivar tampoco se puede reclamar.
-- Confirmar/cancelar una franja ya asignada y las transiciones del scheduler
-- conservan sus reglas anteriores.
create or replace function public.act_on_practice_slot(p_slot_id uuid, p_student_id uuid, p_action text)
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
    perform 1 from public.enrollments e where e.student_id = p_student_id
      and e.cohort_id = current_slot.cohort_id and e.status = 'activo' for share;
    if not found then
      raise exception using errcode = 'CD403',
        message = 'No tienes una inscripción activa en la cohorte de esta franja';
    end if;
    if current_slot.status not in ('disponible', 'liberado') then
      raise exception using errcode = 'CD409', message = 'Esta franja ya no está disponible';
    end if;
    perform 1 from public.users u where u.id = current_slot.instructor_id and u.activo for share;
    if not found then
      raise exception using errcode = 'CD023', message = 'El instructor está inactivo';
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
revoke all on function public.act_on_practice_slot(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.act_on_practice_slot(uuid, uuid, text) to service_role;

-- La comprobación y el cambio comparten una transacción con las inserciones.
create function public.set_instructor_active(p_id uuid, p_active boolean)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  instructor_role public.user_role;
begin
  select rol into instructor_role from public.users where id = p_id for update;
  if instructor_role is distinct from 'instructor' then return false; end if;
  if not p_active and exists (
    select 1 from public.practice_slots
    where instructor_id = p_id and scheduled_at > now()
      and status in ('asignado', 'confirmado')
  ) then
    raise exception using errcode = 'CD024',
      message = 'El instructor tiene franjas futuras asignadas o confirmadas';
  end if;
  update public.users set activo = p_active where id = p_id;
  return true;
end;
$$;
revoke all on function public.set_instructor_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_instructor_active(uuid, boolean) to service_role;

notify pgrst, 'reload schema';
commit;
