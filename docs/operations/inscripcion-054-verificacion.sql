-- MANUAL; termina con ROLLBACK y no deja datos.
begin;
do $$ declare rol text;f text;begin
 foreach f in array array['public.certificado_original_requerido(uuid)',
  'public.franjas_identidad_pendiente(uuid,uuid[])','public.confirmar_identidad_presencial(uuid,uuid,boolean)'] loop
  if to_regprocedure(f) is null then raise exception 'Falta %',f;end if;
  foreach rol in array array['anon','authenticated'] loop
   if has_function_privilege(rol,f,'EXECUTE') then raise exception '% accesible a %',f,rol;end if;
  end loop;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Falta permiso backend en %',f;end if;
 end loop;
 -- Un instructor inexistente se rechaza sin tocar nada.
 begin
  perform public.confirmar_identidad_presencial(gen_random_uuid(),gen_random_uuid(),false);
  raise exception 'Debió fallar';
 exception when sqlstate 'IP403' then null;
 end;
end $$;
rollback;
