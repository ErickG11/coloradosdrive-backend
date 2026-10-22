-- Reversión MANUAL de 029, con aprobación. No toca datos: solo retira los
-- CHECK y el índice único que agregó 029 y restaura los comentarios de
-- columna de 012. Se conservan los mínimos previos (cohorts_precio_non_negative, cohorts_cupo_positive y las dos reglas de
-- fechas de 012). Tras revertir, el servidor sigue validando los mismos
-- límites y el nombre único (comprobación previa), pero sin la red de
-- seguridad de la base frente a dos altas simultáneas.
begin;
set local lock_timeout = '5s';
drop index if exists public.cohorts_course_nombre_unique;
alter table public.cohorts
  drop constraint if exists cohorts_nombre_longitud,
  drop constraint if exists cohorts_precio_maximo,
  drop constraint if exists cohorts_cupo_maximo_rango,
  drop constraint if exists cohorts_vehiculos_rango,
  drop constraint if exists cohorts_aulas_rango,
  drop constraint if exists cohorts_curso_no_antes_matricula;
-- Restaura los comentarios de columna de 012.
comment on column public.cohorts.numero_vehiculos is
  'Metadata informativa para el oficio a la ANT. Sin validación, no se usa en lógica de negocio.';
comment on column public.cohorts.numero_aulas is
  'Metadata informativa para el oficio a la ANT. Sin validación, no se usa en lógica de negocio.';
comment on column public.cohorts.tipo_modalidad is
  'Metadata informativa para el oficio a la ANT. Sin validación, no se usa en lógica de negocio.';
comment on column public.cohorts.horarios_capacitacion_teoria is
  'Metadata informativa para el oficio a la ANT. Sin validación, no se usa en lógica de negocio.';
notify pgrst, 'reload schema';
commit;
