-- F45 exclusivamente/manual: fixtures locales, sin persistencia.
begin;
create temp table i17_fixture(id uuid,course uuid) on commit drop;
insert into i17_fixture values(gen_random_uuid(),gen_random_uuid());
do $$ declare f i17_fixture;r text;func text;d jsonb;begin
 select * into f from i17_fixture;
 insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values(f.course,'Fixture I17','B',15,18);
 insert into public.solicitudes_inscripcion(id,correo,correo_verificado,course_id,estado)
 values(f.id,f.id::text||'@example.com',true,f.course,'borrador');
 perform public.aceptar_consentimiento_inscripcion(f.id,'fixture-i17','fixture-i17',false);
 d:=jsonb_build_object('nombres','María José','apellidos','Pérez Ruiz','cedula','1710034065',
 'fechaNacimiento','1980-01-01','nacionalidadTipo','ecuatoriana','tipoSangre','no_sabe','nivelEstudios','bachiller');
 begin perform public.guardar_datos_inscripcion(f.id,d,'fixture-i17','fixture-i17');raise exception 'Aceptó teléfono ausente';exception when sqlstate 'SI436' then null;end;
 foreach r in array array['+593991234567','09 91234567','099123456','0223456789'] loop
 begin perform public.guardar_datos_inscripcion(f.id,d||jsonb_build_object('telefono',r),'fixture-i17','fixture-i17');raise exception 'Aceptó teléfono inválido';exception when sqlstate 'SI436' then null;end;end loop;
 d:=d||jsonb_build_object('telefono','0991234567');
 begin perform public.guardar_datos_inscripcion(f.id,d||jsonb_build_object('nivelEstudios','cursando_bachillerato'),'fixture-i17','fixture-i17');raise exception 'Aceptó nivel retirado';exception when sqlstate 'SI437' then null;end;
 perform public.guardar_datos_inscripcion(f.id,d,'fixture-i17','fixture-i17');
 -- Simula un borrador histórico sin teléfono; el envío debe impedirlo.
 update public.solicitudes_inscripcion set telefono=null where id=f.id;
 begin perform public.enviar_solicitud_inscripcion(f.id,'enviar','fixture-i17','fixture-i17');raise exception 'Envió sin teléfono';exception when sqlstate 'SI436' then null;end;
 perform public.guardar_datos_inscripcion(f.id,d||jsonb_build_object('telefono','022345678'),'fixture-i17','fixture-i17');
 perform public.enviar_solicitud_inscripcion(f.id,'enviar','fixture-i17','fixture-i17');
 if not exists(select 1 from public.solicitudes_inscripcion where id=f.id and estado='enviada' and telefono='022345678') then raise exception 'No envió teléfono convencional';end if;
 foreach func in array array['public.guardar_datos_inscripcion(uuid,jsonb,text,text)','public.enviar_solicitud_inscripcion(uuid,text,text,text)'] loop
 foreach r in array array['anon','authenticated'] loop
 if has_function_privilege(r,func,'EXECUTE') then raise exception 'RPC expuesta a %',r;end if;end loop;
 if not has_function_privilege('service_role',func,'EXECUTE') then raise exception 'Falta permiso backend';end if;end loop;
end $$;
rollback;
