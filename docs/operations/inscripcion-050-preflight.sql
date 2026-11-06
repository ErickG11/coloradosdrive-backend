-- MANUAL, sin escrituras ni datos personales.
begin;
do $$ begin
 if to_regprocedure('public.enviar_solicitud_inscripcion(uuid,text,text,text)') is null
  or to_regclass('public.solicitud_verificaciones') is null
  or to_regclass('public.solicitudes_admin') is null then raise exception '050 requiere 042–049 completas';end if;
 if not has_table_privilege('service_role','public.solicitud_verificaciones','INSERT')
  or not has_table_privilege('service_role','public.solicitudes_admin','SELECT') then
  raise exception 'service_role sin permisos sobre verificaciones o la vista';end if;
 if not exists(select 1 from pg_trigger where tgname='solicitud_verificaciones_inmutables'
  and tgrelid='public.solicitud_verificaciones'::regclass) then
  raise exception 'Falta el trigger append-only de 042';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='solicitud_documentos' and column_name='archivo_verificado_at') then
  raise exception 'Falta archivo_verificado_at (042)';end if;
end $$;
select 'Crear registrar_verificacion_inscripcion y listar_solicitudes_admin; ampliar guard_solicitud_edit' as cambio;
select count(*) as verificaciones_existentes from public.solicitud_verificaciones;
rollback;
