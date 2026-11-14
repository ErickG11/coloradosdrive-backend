begin;
set local lock_timeout='5s';
do $$begin
 if exists(select 1 from public.enrollment_rule_flags where enabled or(key in('permissions','metrics') and implemented)) then raise exception 'Apagar indicadores y revertir lotes posteriores';end if;
end $$;
do $$declare r record;begin for r in select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('guardar_datos_inscripcion','enviar_solicitud_inscripcion','validar_aprobacion_inscripcion','legacy079_finalizar_aprobacion_inscripcion','commit_manual_enrollment','list_admin_students','listar_solicitudes_admin') loop
 execute format('drop function public.%I(%s)',r.proname,r.args);execute format('alter function public.%I(%s) rename to %I','legacy080_'||r.proname,r.args,r.proname);end loop;end $$;
update public.enrollment_rule_flags set implemented=false,enabled=false where key='foreign_identity';
-- Conservar tipos/números, índices y procedencia. No convertir pasaportes en cédulas ni borrar filas.
-- Si hay extranjeros, conservar lector compatible y suspender nuevas escrituras de esos casos hasta reaplicar.
notify pgrst,'reload schema';
commit;
