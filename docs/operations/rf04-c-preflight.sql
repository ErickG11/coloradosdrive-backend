-- Solo lectura, SQL Editor antes de 036. Comparar tambien el historial manual de migraciones.
-- Todos los indicadores deben ser true. 035 es la ultima migracion previa del repo.
select to_regprocedure('public.admin_instructor_rating_detail(uuid,uuid,integer,integer)') as signature;
select f.oid::regprocedure as signature,
  md5(replace(f.prosrc,E'\r',''))='75db43164901732011d52359026f8e6d' as body_is_035,
  f.prorettype='jsonb'::regtype and not f.proretset and f.prokind='f' as returns_jsonb,
  f.proargnames=array['p_actor','p_instructor','p_page','p_page_size']::text[]
    and f.pronargdefaults=2 and pg_get_expr(f.proargdefaults,0)='1, 20' as arguments_match,
  not f.prosecdef and f.provolatile='s' and l.lanname='plpgsql'
    and f.proconfig=array['search_path=""']::text[] as security_matches,
  has_function_privilege('service_role',f.oid,'EXECUTE') as service_role_can_execute,
  not has_function_privilege('anon',f.oid,'EXECUTE')
    and not has_function_privilege('authenticated',f.oid,'EXECUTE') as clients_cannot_execute,
  not exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    where a.grantee not in (f.proowner,(select oid from pg_roles where rolname='service_role'))) as only_owner_and_service_role,
  f.proacl as acl
from pg_proc f join pg_language l on l.oid=f.prolang
where f.oid=to_regprocedure('public.admin_instructor_rating_detail(uuid,uuid,integer,integer)');

select to_regclass('public.users') is not null
  and to_regclass('public.practice_slots') is not null
  and to_regclass('public.practice_ratings') is not null as tables_exist;
select pg_get_functiondef('public.admin_instructor_rating_detail(uuid,uuid,integer,integer)'::regprocedure);
