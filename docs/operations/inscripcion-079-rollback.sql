begin;
set local lock_timeout='5s';
do $$begin
 if exists(select 1 from public.enrollment_rule_flags where enabled or(key in('foreign_identity','permissions','metrics') and implemented)) then raise exception 'Apagar indicadores y revertir lotes posteriores';end if;
 if exists(select 1 from public.solicitud_auditoria where email_state in('queued','processing')) then raise exception 'Resolver correos de estado antes de retirar el trabajo';end if;
end $$;
-- Escrituras originales, sin borrar archivo, evidencia, bloqueos ni correos históricos.
do $$declare r record;begin for r in select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in('registrar_verificacion_inscripcion','reclamar_aprobacion_inscripcion','finalizar_aprobacion_inscripcion','devolver_solicitud_inscripcion','rechazar_solicitud_inscripcion','listar_solicitudes_admin') loop
 execute format('drop function public.%I(%s)',r.proname,r.args);execute format('alter function public.%I(%s) rename to %I','legacy079_'||r.proname,r.args,r.proname);end loop;end $$;
drop trigger request_state_email on public.solicitudes_inscripcion;
update public.enrollment_rule_flags set implemented=false,enabled=false where key='identity';
-- Conservar protección de borrado de aprobadas/archivadas y reconocimiento de escaneos en huérfanos.
-- Mantener lector compatible 079 si existen archivos: no reinterpretarlos como solicitudes abiertas.
notify pgrst,'reload schema';
commit;
