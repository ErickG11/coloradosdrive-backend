-- SOLO LECTURA. Ejecutar únicamente con autorización para la base elegida.
begin transaction read only;

-- 1. Debe devolver cero filas, incluidos registros terminales.
select id, duration_minutes, scheduled_at
from public.practice_slots
where duration_minutes is distinct from 60
   or scheduled_at is null or not isfinite(scheduled_at)
   or scheduled_at > timestamptz '294276-12-31 22:59:59+00';

-- 2. Intersecciones [inicio, fin), con la duración ACTUAL del registro.
-- Solo calcula rangos para valores válidos; no normaliza datos.
with occupied as (
  select id, instructor_id, scheduled_at, duration_minutes
  from public.practice_slots
  where status in ('disponible', 'asignado', 'confirmado', 'liberado', 'completado')
    and isfinite(scheduled_at) and duration_minutes = 60
    and scheduled_at <= timestamptz '294276-12-31 22:59:59+00'
)
select a.id as first_slot, b.id as second_slot, a.instructor_id,
       a.scheduled_at as first_start, b.scheduled_at as second_start
from occupied a join occupied b on a.instructor_id = b.instructor_id and a.id < b.id
where tsrange(a.scheduled_at at time zone 'UTC',
              (a.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
   && tsrange(b.scheduled_at at time zone 'UTC',
              (b.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)');

-- 3. Precondiciones de infraestructura, permisos y esquema; revisar resultados.
select name, installed_version from pg_available_extensions where name = 'btree_gist';
select e.extname, n.nspname as extension_schema from pg_extension e
join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gist';
select rolname from pg_roles where rolname in ('service_role', 'anon', 'authenticated');
select column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'practice_slots'
  and column_name in ('scheduled_at', 'duration_minutes', 'status');
select indexname, indexdef from pg_indexes
where schemaname = 'public' and indexname = 'practice_slots_instructor_no_overlap';

-- Detectar también solapamientos con duraciones no válidas sin construir rangos.
-- Así los registros de 45/90 minutos no quedan fuera del diagnóstico.
select a.id as first_slot, b.id as second_slot, a.instructor_id
from public.practice_slots a join public.practice_slots b
  on a.instructor_id = b.instructor_id and a.id < b.id
where a.status in ('disponible', 'asignado', 'confirmado', 'liberado', 'completado')
  and b.status in ('disponible', 'asignado', 'confirmado', 'liberado', 'completado')
  and isfinite(a.scheduled_at) and isfinite(b.scheduled_at)
  and a.duration_minutes > 0 and b.duration_minutes > 0
  -- Comparar diferencias evita desbordar al sumar duraciones históricas extremas.
  and extract(epoch from (a.scheduled_at - b.scheduled_at)) < b.duration_minutes::numeric * 60
  and extract(epoch from (b.scheduled_at - a.scheduled_at)) < a.duration_minutes::numeric * 60;

rollback;
