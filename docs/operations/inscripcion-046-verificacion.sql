-- MANUAL reversible, sin datos personales. No ejecutado por el agente.
begin;
do $$ declare rol text;begin
 if not exists(select 1 from pg_constraint where conrelid='public.solicitud_consentimientos'::regclass
  and conname='solicitud_consentimientos_versiones_key') then raise exception 'Falta unicidad versionada';end if;
 foreach rol in array array['anon','authenticated'] loop
  if has_function_privilege(rol,'public.aceptar_consentimiento_inscripcion(uuid,text,text,boolean)','EXECUTE')
   or has_table_privilege(rol,'public.solicitud_consentimientos','SELECT,INSERT,UPDATE,DELETE') then
   raise exception 'Permiso indebido de %',rol;end if;
 end loop;
 if not has_function_privilege('service_role','public.aceptar_consentimiento_inscripcion(uuid,text,text,boolean)','EXECUTE')
  or not (select relrowsecurity from pg_class where oid='public.solicitud_consentimientos'::regclass) then
  raise exception 'Falta permiso backend o RLS';end if;
end $$;
rollback;
