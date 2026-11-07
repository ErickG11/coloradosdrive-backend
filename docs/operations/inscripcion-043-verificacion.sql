-- F02. Aplicación manual después de 043. Sin datos reales; termina con ROLLBACK.
begin;
set local statement_timeout='30s';
-- Comparar el ACL exacto de TODAS las funciones de extensiones, sin tocarlas.
do $extension$ declare actual jsonb; esperado jsonb; begin
  select extensiones into esperado from public.inscripcion_endurecimiento_respaldo where id;
  if esperado is null then raise exception 'Falta respaldo de 043'; end if;
  select coalesce(jsonb_object_agg(p.oid::text,to_jsonb(p.proacl)),'{}'::jsonb) into actual
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','coloradosdrive_private')
      and exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');
  if actual is distinct from esperado then raise exception 'Los permisos de extensiones cambiaron desde el respaldo'; end if;
end $extension$;
create temporary table f02_tablas on commit drop as
  select c.oid,format('%I.%I',n.nspname,c.relname) as nombre,
    (select attname from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped order by attnum limit 1) as columna
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p');
grant select on f02_tablas to anon,authenticated;
create temporary table f02_helpers on commit drop as
  select p.oid,p.proname from pg_proc p where p.oid in
    ('private.can_subscribe_cohort_channel(text)'::regprocedure,'private.student_realtime_account_active()'::regprocedure);
grant select on f02_helpers to anon,authenticated;

set local role authenticated;
do $permisos$
declare t record; sentencia text; f record; permitido boolean; v_cohort oid; v_active oid;
begin
  permitido := current_user='authenticated';
  select oid into v_cohort from pg_temp.f02_helpers where proname='can_subscribe_cohort_channel';
  select oid into v_active from pg_temp.f02_helpers where proname='student_realtime_account_active';
  if permitido and not has_schema_privilege(current_user,'private','USAGE') then
    raise exception 'authenticated necesita USAGE en private';
  end if;
  if has_function_privilege(current_user,v_cohort,'EXECUTE') is distinct from permitido
    or has_function_privilege(current_user,v_active,'EXECUTE') is distinct from permitido then
    raise exception 'Permisos de Broadcast incorrectos para %',current_user;
  end if;
  if permitido then
    perform private.student_realtime_account_active();
    perform private.can_subscribe_cohort_channel('cohort-00000000-0000-4000-8000-000000000000-practice-slots');
  else
    begin perform private.student_realtime_account_active();
      raise exception 'anon ejecutó helper privado'; exception when insufficient_privilege then null; end;
    begin perform private.can_subscribe_cohort_channel('cohort-00000000-0000-4000-8000-000000000000-practice-slots');
      raise exception 'anon ejecutó helper privado'; exception when insufficient_privilege then null; end;
  end if;
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','coloradosdrive_private') and p.prokind in ('f','w')
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      and not (permitido and p.oid in (v_cohort,v_active)) loop
    if has_function_privilege(current_user,f.oid,'EXECUTE') then
      raise exception 'Función propia inesperadamente ejecutable: % para %',f.oid::regprocedure,current_user;
    end if;
  end loop;
  for t in select * from pg_temp.f02_tablas loop
    if has_table_privilege(current_user,t.oid,'SELECT,INSERT,UPDATE,DELETE')
      or has_any_column_privilege(current_user,t.oid,'SELECT,INSERT,UPDATE') then
      raise exception 'Todavía hay grants de tabla/columna en % para %',t.nombre,current_user;
    end if;
    foreach sentencia in array array[
      format('select 1 from %s limit 0',t.nombre),
      format('insert into %s default values',t.nombre),
      format('update %s set %I=%I where false',t.nombre,t.columna,t.columna),
      format('delete from %s where false',t.nombre)] loop
      begin
        execute sentencia;
        raise exception 'DML no denegado en % para %',t.nombre,current_user;
      exception when insufficient_privilege then null;
      end;
    end loop;
  end loop;
end $permisos$;
reset role;

set local role anon;
do $permisos$
declare t record; sentencia text; f record; permitido boolean; v_cohort oid; v_active oid;
begin
  permitido := current_user='authenticated';
  select oid into v_cohort from pg_temp.f02_helpers where proname='can_subscribe_cohort_channel';
  select oid into v_active from pg_temp.f02_helpers where proname='student_realtime_account_active';
  if permitido and not has_schema_privilege(current_user,'private','USAGE') then
    raise exception 'authenticated necesita USAGE en private';
  end if;
  if has_function_privilege(current_user,v_cohort,'EXECUTE') is distinct from permitido
    or has_function_privilege(current_user,v_active,'EXECUTE') is distinct from permitido then
    raise exception 'Permisos de Broadcast incorrectos para %',current_user;
  end if;
  if permitido then
    perform private.student_realtime_account_active();
    perform private.can_subscribe_cohort_channel('cohort-00000000-0000-4000-8000-000000000000-practice-slots');
  else
    begin perform private.student_realtime_account_active();
      raise exception 'anon ejecutó helper privado'; exception when insufficient_privilege then null; end;
    begin perform private.can_subscribe_cohort_channel('cohort-00000000-0000-4000-8000-000000000000-practice-slots');
      raise exception 'anon ejecutó helper privado'; exception when insufficient_privilege then null; end;
  end if;
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','coloradosdrive_private') and p.prokind in ('f','w')
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      and not (permitido and p.oid in (v_cohort,v_active)) loop
    if has_function_privilege(current_user,f.oid,'EXECUTE') then
      raise exception 'Función propia inesperadamente ejecutable: % para %',f.oid::regprocedure,current_user;
    end if;
  end loop;
  for t in select * from pg_temp.f02_tablas loop
    if has_table_privilege(current_user,t.oid,'SELECT,INSERT,UPDATE,DELETE')
      or has_any_column_privilege(current_user,t.oid,'SELECT,INSERT,UPDATE') then
      raise exception 'Todavía hay grants de tabla/columna en % para %',t.nombre,current_user;
    end if;
    foreach sentencia in array array[
      format('select 1 from %s limit 0',t.nombre),
      format('insert into %s default values',t.nombre),
      format('update %s set %I=%I where false',t.nombre,t.columna,t.columna),
      format('delete from %s where false',t.nombre)] loop
      begin
        execute sentencia;
        raise exception 'DML no denegado en % para %',t.nombre,current_user;
      exception when insufficient_privilege then null;
      end;
    end loop;
  end loop;
end $permisos$;
reset role;

-- Objetos futuros de postgres en public tampoco heredan acceso público.
create table public.f02_prueba_defaults(id integer);
alter table public.f02_prueba_defaults enable row level security;
create sequence public.f02_prueba_secuencia;
create function public.f02_prueba_funcion() returns integer language sql as $$select 1$$;
do $defaults$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if has_table_privilege(r,'public.f02_prueba_defaults','SELECT,INSERT,UPDATE,DELETE')
      or has_sequence_privilege(r,'public.f02_prueba_secuencia','USAGE,SELECT,UPDATE')
      or has_function_privilege(r,'public.f02_prueba_funcion()','EXECUTE') then
      raise exception 'Defaults públicos incorrectos para %',r;
    end if;
  end loop;
end $defaults$;
rollback;
