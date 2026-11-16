-- MANUAL, solo lectura. Antes de aplicar 095 (ADR 027).
select to_regprocedure('public.confirmar_identidad_presencial_admin(uuid,uuid,text)') is not null as funcion_056,
 to_regclass('public.identidad_presencial_overrides') is not null as tabla_overrides,
 (select count(*) from public.identidad_presencial_overrides) as confirmaciones_previas,
 (select is_nullable from information_schema.columns where table_schema='public'
   and table_name='identidad_presencial_overrides' and column_name='slot_id') as slot_id_nulable_antes;
-- Esperado: funcion_056 y tabla_overrides en true; slot_id_nulable_antes en NO.
