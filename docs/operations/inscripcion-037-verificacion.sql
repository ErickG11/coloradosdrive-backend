begin;
do $$ begin
 if not exists(select 1 from pg_class where oid='public.solicitud_consentimientos'::regclass and relrowsecurity)
 or not exists(select 1 from pg_class where oid='public.solicitud_auditoria'::regclass and relrowsecurity) then
   raise exception 'RLS ausente'; end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename in ('solicitud_consentimientos','solicitud_auditoria')) then
   raise exception 'Las tablas deben carecer de políticas públicas'; end if;
 if has_table_privilege('anon','public.solicitud_consentimientos','SELECT')
 or has_table_privilege('authenticated','public.solicitud_auditoria','INSERT') then
   raise exception 'Permisos públicos inesperados'; end if;
end $$;
-- Evento sintético, no se persiste; no requiere una persona/solicitud real.
insert into public.solicitud_auditoria(solicitud_id,accion) values(gen_random_uuid(),'verificacion');
select column_name from information_schema.columns where table_schema='public'
 and table_name='solicitudes_inscripcion' and column_name='solicitada_at';
rollback;
