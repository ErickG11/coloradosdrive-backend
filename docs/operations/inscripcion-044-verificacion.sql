-- Manual; todas las escrituras terminan en ROLLBACK. Sin datos personales.
begin;
set local statement_timeout='15s';
do $$ declare v jsonb; topes jsonb:='{"codigosIpHora":60,"codigosCorreoDia":5,"fallosCorreoDia":10,"subidasIpDia":5,"codigos":250,"solicitudes":150,"subidas":40}'; begin
  if not exists(select 1 from public.app_settings where id and inscripciones_abiertas) then
    raise exception 'Para el ensayo reversible se requiere inscripción abierta';end if;
  -- Clave ficticia aleatoria; no corresponde a correo/IP real.
  v:=public.reservar_limite_inscripcion('codigo_ip',replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),null,topes);
  if not (v->>'permitido')::boolean then raise exception 'No se pudo reservar límite IP ficticio';end if;
  if has_function_privilege('anon','public.reservar_limite_inscripcion(text,text,text,jsonb,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.crear_borrador_limitado(text,uuid,text,timestamptz,jsonb)','EXECUTE') then
    raise exception 'RPC accesible a roles públicos';end if;
  if public.resumen_solicitudes() ? 'documentosPorRevisar' then raise exception 'Resumen legacy inesperado';end if;
end $$;
rollback;
