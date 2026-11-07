-- MANUAL, sin escrituras ni datos personales.
begin;
do $$ begin
 if to_regprocedure('public.aceptar_consentimiento_inscripcion(uuid,text,text,boolean)') is null
  or to_regclass('public.solicitudes_cedula_activa_unique') is null
  or to_regclass('public.users') is null then raise exception '047 requiere 042–046 completas';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='courses'
  and column_name='edad_minima') then raise exception 'Falta edad mínima del curso';end if;
end $$;
select 'Añadir datos_actualizados_at; crear RPC privada de datos/representante con lock de solicitud y cédula' as cambio;
select indexname,indexdef from pg_indexes where schemaname='public' and indexname='solicitudes_cedula_activa_unique';
rollback;
