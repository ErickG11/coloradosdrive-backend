-- MANUAL, sin escrituras ni datos personales.
begin;
do $$ begin
 if to_regprocedure('public.guardar_datos_inscripcion(uuid,jsonb,text,text)') is null
  or to_regclass('public.solicitud_documentos') is null
  or to_regclass('public.solicitud_auditoria') is null then raise exception '048 requiere 042–047 completas';end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='solicitud_documentos'
  and column_name in ('subtipo','mime_type','size_bytes','sha256','archivo_verificado_at','archivo_eliminado_at'))<>6 then
  raise exception 'Faltan columnas del certificado (042)';end if;
end $$;
select 'Crear RPC privada guardar_certificado_inscripcion con lock de solicitud y CAS de nivel/marca de datos' as cambio;
select count(*) as certificados_existentes from public.solicitud_documentos where tipo_documento='certificado_estudios';
rollback;
