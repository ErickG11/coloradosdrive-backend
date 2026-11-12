-- Rollback funcional, conservar auditoría, facturas y documentos.
begin;
update public.enrollment_rule_flags set enabled=false;
drop trigger if exists enrollment_activation_l11 on public.enrollment_rule_flags;
do $$declare r record;definition text;target text;begin
 for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'legacyL11_%' loop
 target:=substring(r.proname from 11);definition:=replace(pg_get_functiondef(r.oid),format('FUNCTION public.%I(',r.proname),format('FUNCTION public.%I(',target));execute definition;end loop;end $$;
update public.enrollment_rule_flags set implemented=false where key in('permissions','metrics');
-- Mantener el índice que admite abonos: revertirlo borraría o bloquearía evidencia fiscal.
commit;
