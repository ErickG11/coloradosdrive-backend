-- MANUAL; termina con ROLLBACK. No requiere datos reales.
begin;
do $$ declare rol text;f text;
begin
 foreach f in array array['public.registrar_verificacion_inscripcion(uuid,uuid,text,text,text,text,boolean)',
   'public.listar_solicitudes_admin(text,text,integer,integer)'] loop
  if to_regprocedure(f) is null then raise exception 'Falta %',f;end if;
  foreach rol in array array['anon','authenticated'] loop
   if has_function_privilege(rol,f,'EXECUTE') then raise exception '% accesible a %',f,rol;end if;
  end loop;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Falta permiso backend en %',f;end if;
 end loop;
 -- La búsqueda con comodines y signos de filtro no debe fallar ni coincidir con todo.
 if (public.listar_solicitudes_admin(null,'%',1,10)->>'total') is null then raise exception 'Listado inválido';end if;
 if (public.listar_solicitudes_admin('enviada',E'a\\_(,)',1,10)->>'total') is null then raise exception 'Listado inválido';end if;
 begin perform public.listar_solicitudes_admin('borrador',null,1,10);raise exception 'Debió fallar';
 exception when sqlstate '22023' then null;end;
 begin perform public.registrar_verificacion_inscripcion(gen_random_uuid(),gen_random_uuid(),'identidad',
   'registro_civil_portal','verificado',null,true);raise exception 'Debió fallar';
 exception when sqlstate 'SI404' then null;end;
end $$;
rollback;
