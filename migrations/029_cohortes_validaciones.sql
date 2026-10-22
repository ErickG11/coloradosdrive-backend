-- 029: límites de datos de cohortes y nombre único por curso (lote L3b).
-- Entregar a Erick; NO aplicar automáticamente. Antes ejecutar
-- docs/operations/cohortes-validaciones-preflight.sql: si P2 o P3 devuelven
-- filas, corregir esos datos primero. Esta migración NO corrige datos:
-- aborta con un mensaje claro y no deja cambios a medias.
-- Solo agrega CHECK e índice; no cambia columnas ni filas. Rollback:
-- docs/operations/cohortes-validaciones-rollback.sql.
-- Se conservan los mínimos existentes cohorts_precio_non_negative,
-- cohorts_cupo_positive, cohorts_fechas_curso_validas y
-- cohorts_fechas_matricula_validas (001/012).
-- El tope «hoy + 5 años» de las fechas NO va como CHECK (depende de la fecha
-- actual): vive solo en el servidor. Los largos de tipo_modalidad (100) y
-- horarios_capacitacion_teoria (500) también son solo del servidor.
begin;
set local lock_timeout = '5s';

do $$
declare v_count integer;
begin
  select count(*) into v_count from (
    select 1 from public.cohorts
    group by course_id, lower(btrim(nombre)) having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'Migración 029 abortada: % grupo(s) de cohortes repiten nombre dentro del mismo curso (sin distinguir mayúsculas ni espacios). Revisa P2 del preflight y renombra antes de aplicar.', v_count
      using errcode = '55000';
  end if;

  select count(*) into v_count from public.cohorts
    where char_length(btrim(nombre)) not between 1 and 100;
  if v_count > 0 then
    raise exception 'Migración 029 abortada: % cohorte(s) tienen el nombre vacío o de más de 100 caracteres. Revisa P3 del preflight.', v_count
      using errcode = '55000';
  end if;

  select count(*) into v_count from public.cohorts where precio > 9999.99;
  if v_count > 0 then
    raise exception 'Migración 029 abortada: % cohorte(s) tienen un precio mayor a 9999.99. Revisa P3 del preflight.', v_count
      using errcode = '55000';
  end if;

  select count(*) into v_count from public.cohorts where cupo_maximo > 500;
  if v_count > 0 then
    raise exception 'Migración 029 abortada: % cohorte(s) tienen un cupo máximo mayor a 500. Revisa P3 del preflight.', v_count
      using errcode = '55000';
  end if;

  select count(*) into v_count from public.cohorts
    where numero_vehiculos not between 0 and 100 or numero_aulas not between 0 and 100;
  if v_count > 0 then
    raise exception 'Migración 029 abortada: % cohorte(s) tienen vehículos o aulas fuera de 0-100. Revisa P3 del preflight.', v_count
      using errcode = '55000';
  end if;

  select count(*) into v_count from public.cohorts where fecha_fin_curso < fecha_inicio_matricula;
  if v_count > 0 then
    raise exception 'Migración 029 abortada: % cohorte(s) terminan el curso antes de que abra la matrícula. Revisa P3 del preflight.', v_count
      using errcode = '55000';
  end if;
end $$;

alter table public.cohorts
  add constraint cohorts_nombre_longitud check (char_length(btrim(nombre)) between 1 and 100),
  add constraint cohorts_precio_maximo check (precio <= 9999.99),
  add constraint cohorts_cupo_maximo_rango check (cupo_maximo <= 500),
  add constraint cohorts_vehiculos_rango check (numero_vehiculos between 0 and 100),
  add constraint cohorts_aulas_rango check (numero_aulas between 0 and 100),
  add constraint cohorts_curso_no_antes_matricula check (fecha_fin_curso >= fecha_inicio_matricula);

comment on constraint cohorts_nombre_longitud on public.cohorts is
  'Nombre de 1 a 100 caracteres sin contar espacios extremos (el servidor ya lo guarda recortado).';
comment on constraint cohorts_vehiculos_rango on public.cohorts is
  'Opcional (null permitido). 0 es válido: el servidor admite enteros de 0 a 100.';
comment on constraint cohorts_aulas_rango on public.cohorts is
  'Opcional (null permitido). 0 es válido: el servidor admite enteros de 0 a 100.';
comment on constraint cohorts_curso_no_antes_matricula on public.cohorts is
  'El curso no puede terminar antes de que abra la matrícula. Sí se permite que la matrícula cierre después de que empiece el curso.';

-- Actualiza los comentarios de 012 («Sin validación»): ahora tienen límites.
comment on column public.cohorts.numero_vehiculos is
  'Metadata informativa para el oficio a la ANT; no se usa en lógica de negocio. Opcional; entero de 0 a 100 (servidor y cohorts_vehiculos_rango).';
comment on column public.cohorts.numero_aulas is
  'Metadata informativa para el oficio a la ANT; no se usa en lógica de negocio. Opcional; entero de 0 a 100 (servidor y cohorts_aulas_rango).';
comment on column public.cohorts.tipo_modalidad is
  'Metadata informativa para el oficio a la ANT; no se usa en lógica de negocio. Opcional; hasta 100 caracteres (validado solo en el servidor).';
comment on column public.cohorts.horarios_capacitacion_teoria is
  'Metadata informativa para el oficio a la ANT; no se usa en lógica de negocio. Opcional; hasta 500 caracteres (validado solo en el servidor).';

create unique index cohorts_course_nombre_unique
  on public.cohorts (course_id, lower(btrim(nombre)));
comment on index public.cohorts_course_nombre_unique is
  'Una cohorte no puede repetir nombre dentro del mismo curso (sin distinguir mayúsculas ni espacios extremos); el mismo nombre en otro curso sí se permite.';

notify pgrst, 'reload schema';
commit;
