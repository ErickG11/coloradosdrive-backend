-- Verificación operativa de catálogo, sin crear usuarios/solicitudes ni ejecutar aprobación.
-- Entregada para ejecución MANUAL; no ejecutada en esta tarea.
begin;
do $$ declare f regprocedure:='public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)'::regprocedure;
 v_body text;rol text;begin
 select prosrc into v_body from pg_proc where oid=f;
 if position('p_estado::public.enrollment_status' in v_body)=0 then raise exception 'Falta conversión del estado';end if;
 if (select prosecdef from pg_proc where oid=f) then raise exception 'La función no debe ser SECURITY DEFINER';end if;
 foreach rol in array array['anon','authenticated'] loop
 if has_function_privilege(rol,f,'EXECUTE') then raise exception 'Permiso indebido: %',rol;end if;end loop;
 if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Falta permiso service_role';end if;
 if to_regprocedure('public.guard_aprobacion_intento()') is null then raise exception 'Falta guarda055';end if;
end $$;
rollback;
