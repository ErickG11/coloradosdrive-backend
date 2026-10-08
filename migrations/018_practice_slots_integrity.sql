-- CD-05 + CD-06. No modifica datos ni migraciones anteriores.
-- Antes de aplicar: docs/operations/cd-05-07-preflight.sql y cd-05-07.md.
begin;
set local lock_timeout = '5s';
-- Resolver primero funciones/operadores de sistema, antes de esquemas de usuario.
set local search_path = pg_catalog, public, extensions, pg_temp;
lock table public.practice_slots in access exclusive mode;

do $$
begin
  if exists (select 1 from public.practice_slots where duration_minutes is distinct from 60) then
    raise exception using errcode = 'CD006',
      message = 'CD-06: existen duraciones distintas de 60; migración detenida sin modificar datos',
      hint = 'Ejecutar el preflight y resolver los registros con autorización del equipo.';
  end if;
  if exists (select 1 from public.practice_slots where not isfinite(scheduled_at)
      or scheduled_at > timestamptz '294276-12-31 22:59:59+00') then
    raise exception using errcode = 'CD006',
      message = 'CD-06: inicio no finito o incompatible con el cálculo del final del intervalo';
  end if;
  if exists (
    select 1 from public.practice_slots a join public.practice_slots b
      on a.instructor_id = b.instructor_id and a.id < b.id
    where a.status in ('disponible', 'asignado', 'confirmado', 'liberado', 'completado')
      and b.status in ('disponible', 'asignado', 'confirmado', 'liberado', 'completado')
      and tsrange(a.scheduled_at at time zone 'UTC',
                  (a.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
       && tsrange(b.scheduled_at at time zone 'UTC',
                  (b.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
  ) then
    raise exception using errcode = 'CD005',
      message = 'CD-05: existen prácticas solapadas; migración detenida sin modificar datos',
      hint = 'Revisar preflight, incluyendo las franjas liberadas. No normalizar automáticamente.';
  end if;
end;
$$;

-- Destino explícito para una instalación nueva; IF NOT EXISTS no mueve una existente.
create extension if not exists btree_gist with schema public;
-- Supabase suele instalar extensiones en extensions; no mover una compartida.
do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'btree_gist' and n.nspname not in ('public', 'extensions')) then
    raise exception 'CD-05: btree_gist está en un esquema no previsto; revisar antes de aplicar';
  end if;
end;
$$;

alter table public.practice_slots
  alter column duration_minutes set default 60,
  add constraint practice_slots_duration_60 check (duration_minutes = 60),
  add constraint practice_slots_finite_start check (
    isfinite(scheduled_at) and scheduled_at <= timestamptz '294276-12-31 22:59:59+00'
  ),
  add constraint practice_slots_instructor_interval_excl exclude using gist (
    instructor_id with =,
    -- UTC explícito: timestamp + interval es inmutable; timestamptz + interval
    -- depende de TimeZone y no es válido como expresión de índice.
    tsrange(scheduled_at at time zone 'UTC',
            (scheduled_at at time zone 'UTC') + interval '60 minutes', '[)') with &&
  ) where (status in ('disponible', 'asignado', 'confirmado', 'liberado', 'completado'));

drop index public.practice_slots_instructor_no_overlap;
comment on constraint practice_slots_instructor_interval_excl on public.practice_slots is
  'CD-05: intervalo [inicio, fin) de 60 minutos por instructor. Liberado y completado bloquean; sin_practica no ocupa el intervalo.';

-- Consulta previa de disponibilidad: misma expresión y estados que la exclusión.
-- No sustituye a la restricción: el INSERT/UPDATE siempre puede perder una carrera.
create function public.practice_free_instructors(
  p_scheduled_ats timestamptz[], p_instructor_id uuid default null
)
returns table(id uuid, nombre_completo text)
language sql stable security invoker set search_path = ''
as $$
  select u.id, u.nombre_completo::text from public.users u
  where u.rol = 'instructor' and (p_instructor_id is null or u.id = p_instructor_id)
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
notify pgrst, 'reload schema';
commit;
