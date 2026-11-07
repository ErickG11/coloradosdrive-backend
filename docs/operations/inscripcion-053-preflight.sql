-- MANUAL, sin escrituras ni datos personales.
begin;
do $$ begin
 if to_regprocedure('public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)') is null
  then raise exception '053 requiere 042–052 completas';end if;
 if to_regclass('storage.objects') is null then raise exception 'Falta storage.objects';end if;
 if not has_table_privilege('service_role','storage.objects','SELECT') then
  raise exception 'service_role no puede leer storage.objects';end if;
 if not exists(select 1 from storage.buckets where id='solicitudes-documentos') then
  raise exception 'Falta el bucket solicitudes-documentos';end if;
end $$;
select 'Crear vencer_solicitudes_devueltas y listar_objetos_huerfanos_solicitudes' as cambio;
select count(*) as devueltas from public.solicitudes_inscripcion where estado='devuelta';
rollback;
