-- REVERSIÓN MANUAL, solo con autorización sobre la base elegida.
-- Detener backend/scheduler y desplegar el backend anterior coordinadamente.
-- Admite 018+019 completas o solo 018 completa (019 abortada/no aplicada).
-- Resolver cualquier transacción fallida previa antes de iniciar este script.
-- Revertir 019 primero, luego 018. No elimina filas ni extensiones compartidas.
begin;
set local lock_timeout = '5s';
lock table public.practice_slots in access exclusive mode;

-- No es un rollback repetible ni de una 018 incompleta. Comprobar antes de DDL.
do $$
begin
  if (select count(*) from pg_catalog.pg_constraint
      where conrelid = 'public.practice_slots'::regclass and convalidated
        and conname in ('practice_slots_duration_60', 'practice_slots_finite_start',
                        'practice_slots_instructor_interval_excl')) <> 3 then
    raise exception using errcode = '55000',
      message = 'Rollback CD-05–07: se requiere la migración 018 completa';
  end if;
end;
$$;

-- Firmas de 019: eliminar primero los llamadores y después sus helpers.
-- IF EXISTS permite que 019 no haya hecho commit. RESTRICT implícito, sin CASCADE:
-- cualquier dependencia ajena impide la reversión y aborta toda la transacción.
drop function if exists public.transition_practice_slot_for_scheduler(uuid, text, text);
drop function if exists public.practice_slots_scheduler_candidates(text);
drop function if exists public.act_on_practice_slot(uuid, uuid, text);
drop function if exists public.practice_slot_transition_due(public.practice_slots, text, timestamptz);
drop function if exists public.practice_slot_window_open(timestamptz, timestamptz);

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

-- Firma de 018; no eliminar otras sobrecargas ni funciones del proyecto.
drop function if exists public.practice_free_instructors(timestamptz[], uuid);
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
