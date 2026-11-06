-- MANUAL, sin escrituras ni datos personales.
begin;
do $$ begin
 if to_regprocedure('public.guardar_certificado_inscripcion(uuid,text,timestamptz,text,text,text,integer,text,text,text)') is null
  or to_regclass('public.solicitud_consentimientos') is null then raise exception '049 requiere 042–048 completas';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='solicitud_consentimientos' and column_name='representante_autoriza_tratamiento') then
  raise exception 'Falta la autorización del representante (046)';end if;
end $$;
select 'Crear RPC privada enviar_solicitud_inscripcion; la RPC antigua enviar_solicitud no se toca' as cambio;
select count(*) as enviadas from public.solicitudes_inscripcion where estado='enviada';
rollback;
