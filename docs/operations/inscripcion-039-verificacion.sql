begin;
do $$ begin
 if has_function_privilege('authenticated','public.eliminar_solicitud_reclamada(uuid,timestamptz,uuid,text)','EXECUTE') then raise exception 'RPC expuesta'; end if;
 begin
 perform public.eliminar_solicitud_reclamada(gen_random_uuid(),now(),null,'verificacion');
 raise exception 'No debe borrar un expediente inexistente';
 exception when sqlstate 'SI409' then null; end;
end $$;
rollback;
