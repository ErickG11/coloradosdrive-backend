-- MANUAL; termina con ROLLBACK. No requiere datos reales.
begin;
do $$ declare rol text;f text;
begin
 foreach f in array array['public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text)',
   'public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)'] loop
  if to_regprocedure(f) is null then raise exception 'Falta %',f;end if;
  foreach rol in array array['anon','authenticated'] loop
   if has_function_privilege(rol,f,'EXECUTE') then raise exception '% accesible a %',f,rol;end if;
  end loop;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Falta permiso backend en %',f;end if;
 end loop;
 begin perform public.reclamar_aprobacion_inscripcion(gen_random_uuid(),gen_random_uuid(),null,null,'a','b');
  raise exception 'Debió fallar';exception when sqlstate 'SI404' then null;end;
 begin perform public.finalizar_aprobacion_inscripcion(gen_random_uuid(),gen_random_uuid(),now(),gen_random_uuid(),null,'activo',null);
  raise exception 'Debió fallar';exception when sqlstate '22023' then null;end;
 begin perform public.finalizar_aprobacion_inscripcion(gen_random_uuid(),gen_random_uuid(),now(),gen_random_uuid(),null,'pendiente_cohorte',null);
  raise exception 'Debió fallar';exception when sqlstate 'SI409' then null;end;
end $$;
rollback;
