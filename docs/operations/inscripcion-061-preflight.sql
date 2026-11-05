-- Solo lectura antes de061.
begin;
do $$ begin
 if to_regprocedure('public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)') is null or not exists(select 1 from pg_attribute where attrelid='public.enrollments'::regclass and attname='etapa_inscripcion' and not attisdropped) then
 raise exception '061 requiere058 y listado Alumnos completo';end if;
 if (select md5(prosrc) from pg_proc where oid='public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'::regprocedure) not in ('210f8316c6b29e4e640d965a1659ef9a','3ed6c97552c91eec1b7bad345c8e3525') then
 raise exception '061: cuerpo de listado distinto del revisado; no modificar sin reconciliar';end if;
end $$;
select 'p_pending no nulo exige etapaactiva; conservar badges para otras etapas en listado sin filtro' as cambio;
rollback;
