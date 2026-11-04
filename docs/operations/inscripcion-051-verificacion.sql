-- MANUAL; termina con ROLLBACK. No requiere datos reales.
begin;
do $$ declare rol text;f text;
begin
 foreach f in array array['public.devolver_solicitud_inscripcion(uuid,uuid,text,text,text)',
   'public.rechazar_solicitud_inscripcion(uuid,uuid,text,text,text,text,integer)',
   'public.validar_aprobacion_inscripcion(uuid,uuid,uuid,text,text)'] loop
  if to_regprocedure(f) is null then raise exception 'Falta %',f;end if;
  foreach rol in array array['anon','authenticated'] loop
   if has_function_privilege(rol,f,'EXECUTE') then raise exception '% accesible a %',f,rol;end if;
  end loop;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Falta permiso backend en %',f;end if;
 end loop;
 begin perform public.devolver_solicitud_inscripcion(gen_random_uuid(),gen_random_uuid(),'OTRO','mensaje largo ok',null);
  raise exception 'Debió fallar';exception when sqlstate 'SI404' then null;end;
 begin perform public.devolver_solicitud_inscripcion(gen_random_uuid(),gen_random_uuid(),'VENCIDA','mensaje largo ok',null);
  raise exception 'Debió fallar';exception when sqlstate '22023' then null;end;
 -- VENCIDA solo la aplica el trabajo programado: no se acepta como rechazo del admin.
 begin perform public.rechazar_solicitud_inscripcion(gen_random_uuid(),gen_random_uuid(),'VENCIDA','mensaje largo ok',null,null,null);
  raise exception 'Debió fallar';exception when sqlstate '22023' then null;end;
 -- SPAM exige hash y días.
 begin perform public.rechazar_solicitud_inscripcion(gen_random_uuid(),gen_random_uuid(),'SPAM','mensaje largo ok',null,null,null);
  raise exception 'Debió fallar';exception when sqlstate '22023' then null;end;
 begin perform public.rechazar_solicitud_inscripcion(gen_random_uuid(),gen_random_uuid(),'OTRO','mensaje largo ok',null,null,null);
  raise exception 'Debió fallar';exception when sqlstate 'SI404' then null;end;
 begin perform public.validar_aprobacion_inscripcion(gen_random_uuid(),null,null,'a','b');
  raise exception 'Debió fallar';exception when sqlstate 'SI404' then null;end;
end $$;
rollback;
