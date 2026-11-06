-- MANUAL; termina con ROLLBACK. No requiere datos reales.
begin;
do $$ declare rol text;f text;
begin
 foreach f in array array['public.vencer_solicitudes_devueltas(integer,text)',
   'public.listar_objetos_huerfanos_solicitudes(timestamptz,integer)'] loop
  if to_regprocedure(f) is null then raise exception 'Falta %',f;end if;
  foreach rol in array array['anon','authenticated'] loop
   if has_function_privilege(rol,f,'EXECUTE') then raise exception '% accesible a %',f,rol;end if;
  end loop;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Falta permiso backend en %',f;end if;
 end loop;
 begin perform public.vencer_solicitudes_devueltas(0,'mensaje largo ok');raise exception 'Debió fallar';
 exception when sqlstate '22023' then null;end;
 if public.listar_objetos_huerfanos_solicitudes(now()-interval '1 day',10) is null then raise exception 'Listado inválido';end if;
end $$;
rollback;
