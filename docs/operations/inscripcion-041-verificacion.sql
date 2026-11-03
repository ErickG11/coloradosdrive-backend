begin;
-- Verificar después de aplicar manualmente. Todo termina en ROLLBACK.
do $$ begin
if has_function_privilege('authenticated','public.revisar_documento_solicitud(uuid,uuid,uuid,text,text)','EXECUTE') then raise exception 'RPC expuesta';end if;
end $$;
rollback;
