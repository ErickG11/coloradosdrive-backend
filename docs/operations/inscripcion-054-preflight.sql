-- MANUAL, solo lectura; termina con ROLLBACK. Falla sin dañar si falta algún requisito.
begin;
do $$ begin
 if to_regclass('public.practice_slots') is null or to_regclass('public.solicitud_auditoria') is null
  or to_regclass('public.solicitudes_inscripcion') is null or to_regclass('public.solicitud_documentos') is null then
  raise exception '054 requiere las tablas del flujo (042)';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='enrollments' and column_name='identidad_presencial_por')
  or not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='enrollments' and column_name='certificado_original_visto')
  or not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='enrollments' and column_name='origen') then
  raise exception 'Faltan columnas de enrollments (042)';end if;
end $$;
select 'Crear certificado_original_requerido, franjas_identidad_pendiente y confirmar_identidad_presencial' as cambio;
select count(*) as matriculas_de_solicitud from public.enrollments where origen='solicitud';
rollback;
