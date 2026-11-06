-- MANUAL; termina con ROLLBACK.
begin;
do $$ declare rol text;
 f text:='public.guardar_certificado_inscripcion(uuid,text,timestamptz,text,text,text,integer,text,text,text)';
begin
 if to_regprocedure(f) is null then raise exception 'Falta la RPC';end if;
 foreach rol in array array['anon','authenticated'] loop
  if has_function_privilege(rol,f,'EXECUTE') then raise exception 'RPC accesible a %',rol;end if;
 end loop;
 if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Falta permiso backend';end if;
end $$;
rollback;
