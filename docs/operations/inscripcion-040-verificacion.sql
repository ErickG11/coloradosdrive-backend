begin;
-- Verificar después de aplicar manualmente. Todo termina en ROLLBACK.
do $$ begin
if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='solicitudes_inscripcion' and column_name='enviada_at') then raise exception 'Falta enviada_at';end if;
if exists(select 1 from public.solicitudes_admin where enviada_at is null) then raise exception 'Borrador expuesto';end if;
if has_function_privilege('anon','public.enviar_solicitud(uuid,text)','EXECUTE') then raise exception 'RPC expuesta';end if;
perform public.resumen_solicitudes();
end $$;
rollback;
