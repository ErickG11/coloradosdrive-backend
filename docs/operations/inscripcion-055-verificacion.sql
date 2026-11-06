-- SOLO arnés F45 o ejecución manual reversible.
begin;
do $$ declare f text;rol text;v_id uuid;v_sol uuid:=gen_random_uuid();v_actor uuid:=gen_random_uuid();r jsonb;begin
 foreach f in array array['public.tomar_recuperacion_aprobacion(uuid,integer,boolean)','public.cerrar_recuperacion_aprobacion(uuid,uuid)','public.liberar_reclamo_aprobacion_legacy(uuid,timestamptz,integer)'] loop
  foreach rol in array array['anon','authenticated'] loop
   if has_function_privilege(rol,f,'EXECUTE') then raise exception 'Acceso indebido';end if;
  end loop;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Falta permiso backend';end if;
 end loop;
 if not (select relrowsecurity from pg_class where oid='public.solicitud_aprobacion_intentos'::regclass)
 or exists(select 1 from pg_policies where schemaname='public' and tablename='solicitud_aprobacion_intentos') then raise exception 'RLS inválido';end if;
 insert into public.solicitud_aprobacion_intentos(solicitud_id,actor_id,claim,updated_at)
 values(v_sol,v_actor,now()-interval '20 minutes',now()-interval '20 minutes') returning id into v_id;
 r:=public.tomar_recuperacion_aprobacion(v_id,10,false);
 if r is null then raise exception 'No tomó intención vencida';end if;
 if public.tomar_recuperacion_aprobacion(v_id,10,true) is not null then raise exception 'Robó lease activo';end if;
 if public.cerrar_recuperacion_aprobacion(v_id,gen_random_uuid()) then raise exception 'Aceptó lease ajeno';end if;
 if not public.cerrar_recuperacion_aprobacion(v_id,(r->>'token')::uuid) then raise exception 'No cerró intención';end if;
 if (select count(*) from public.solicitud_auditoria where solicitud_id=v_sol and accion='aprobacion_compensada')<>1 then raise exception 'Auditoría inválida';end if;
end $$;
rollback;
