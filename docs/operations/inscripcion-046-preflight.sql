-- MANUAL de solo lectura; no modifica ni presume consentimientos.
begin;
do $$ begin
 if to_regprocedure('public.confirmar_codigo_inscripcion(text,text,text,jsonb)') is null
  or to_regclass('public.solicitud_consentimientos') is null
  or to_regclass('public.solicitud_auditoria') is null then
  raise exception '046 requiere 042–045 completas';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='solicitud_consentimientos' and column_name='version_terminos') then
  raise exception 'Falta version_terminos de042';end if;
end $$;
select 'Sustituir unicidad solicitud/aviso por solicitud/aviso/términos; añadir autorización de tratamiento del representante; RPC privada' as cambio;
select conname,pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.solicitud_consentimientos'::regclass;
rollback;
