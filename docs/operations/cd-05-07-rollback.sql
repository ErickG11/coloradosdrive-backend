-- REVERSIÓN MANUAL, solo con autorización sobre la base elegida.
-- Detener backend/scheduler y desplegar el backend anterior coordinadamente.
-- Revertir 019 primero, luego 018. No elimina filas ni extensiones compartidas.
begin;
set local lock_timeout = '5s';
lock table public.practice_slots in access exclusive mode;

drop function public.transition_practice_slot_for_scheduler(uuid, text, text);
drop function public.practice_slots_scheduler_candidates(text);
drop function public.act_on_practice_slot(uuid, uuid, text);
drop function public.practice_slot_transition_due(public.practice_slots, text, timestamptz);
drop function public.practice_slot_window_open(timestamptz, timestamptz);

-- Restaurar los triggers tal como estaban en 005, sin tocar otras funciones.
create or replace function public.enforce_practice_slot_instructor_role()
returns trigger language plpgsql security invoker as $$
declare instructor_role public.user_role;
begin
  select rol into instructor_role from public.users where id = new.instructor_id;
  if instructor_role is distinct from 'instructor' then
    raise exception 'practice_slots.instructor_id (%) must reference a user with rol = instructor', new.instructor_id;
  end if;
  return new;
end;
$$;
alter function public.enforce_practice_slot_instructor_role() reset search_path;
create or replace function public.enforce_practice_slot_student_role()
returns trigger language plpgsql security invoker as $$
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
alter function public.enforce_practice_slot_student_role() reset search_path;

drop function public.practice_free_instructors(timestamptz[], uuid);
-- La exclusión actual implica el índice anterior; crear antes de quitarla.
-- Si datos escritos por otra vía violan el índice anterior, falla sin pérdida.
create unique index practice_slots_instructor_no_overlap
  on public.practice_slots(instructor_id, scheduled_at)
  where status in ('disponible', 'asignado', 'confirmado');
alter table public.practice_slots
  drop constraint practice_slots_instructor_interval_excl,
  drop constraint practice_slots_duration_60,
  drop constraint practice_slots_finite_start,
  alter column duration_minutes drop default;
-- Mantener btree_gist incluso si 018 la instaló: puede ser compartida.
notify pgrst, 'reload schema';
commit;
