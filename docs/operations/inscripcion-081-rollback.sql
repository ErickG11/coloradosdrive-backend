-- Rollback funcional: conservar permisos D8, precios D7, columnas e historial.
begin;
update public.enrollment_rule_flags set enabled=false;
do $$declare r record;meta jsonb;definition text;begin
 for r in select p.oid,p.proname,obj_description(p.oid,'pg_proc') description from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'backup081_%' loop
 meta:=r.description::jsonb;definition:=replace(pg_get_functiondef(r.oid),format('FUNCTION private.%I(',r.proname),format('FUNCTION %I.%I(',meta->>'schema',meta->>'name'));execute definition;end loop;end $$;
-- No reinstalar índice global si A y B conviven. No borrar recibos, facturas o extranjeros.
commit;
