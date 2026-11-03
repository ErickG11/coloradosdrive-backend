-- MANUAL reversible; no ejecutado por el agente en modo sin pruebas.
begin;
do $$ declare rol text;begin
 if not exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='solicitudes_inscripcion' and column_name='datos_actualizados_at') then raise exception 'Falta marca de datos';end if;
 foreach rol in array array['anon','authenticated'] loop
  if has_function_privilege(rol,'public.guardar_datos_inscripcion(uuid,jsonb,text,text)','EXECUTE') then
   raise exception 'RPC accesible a %',rol;end if;
 end loop;
 if not has_function_privilege('service_role','public.guardar_datos_inscripcion(uuid,jsonb,text,text)','EXECUTE') then
  raise exception 'Falta permiso backend';end if;
end $$;
rollback;
