-- MANUAL, sin escrituras ni datos personales.
begin;
do $$ begin
 if to_regprocedure('public.validar_aprobacion_inscripcion(uuid,uuid,uuid,text,text)') is null
  then raise exception '052 requiere 042–051 completas';end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='enrollments'
  and column_name in ('origen','requisitos_verificados_at'))<2 then raise exception 'Faltan columnas de matrícula (042)';end if;
 if not exists(select 1 from pg_trigger where tgname='enrollments_initialize_documents') then
  raise exception 'Falta el trigger del checklist físico (022)';end if;
 if not has_table_privilege('service_role','public.users','INSERT')
  or not has_table_privilege('service_role','public.enrollments','INSERT') then
  raise exception 'service_role sin permisos de inserción';end if;
end $$;
select 'Crear reclamar_aprobacion_inscripcion y finalizar_aprobacion_inscripcion' as cambio;
rollback;
