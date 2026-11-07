begin;
do $$ begin
 if has_function_privilege('anon','public.finalizar_aprobacion_solicitud(uuid,uuid,timestamptz,uuid,uuid)','EXECUTE') then
 raise exception 'RPC expuesta'; end if;
 begin
 perform public.finalizar_aprobacion_solicitud(gen_random_uuid(),gen_random_uuid(),now(),gen_random_uuid(),gen_random_uuid());
 raise exception 'Una aprobación inexistente no debe completarse';
 exception when sqlstate 'SI409' then null; end;
end $$;
rollback;
