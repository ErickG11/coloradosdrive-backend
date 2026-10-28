-- RF-04 C. Aplicacion MANUAL en SQL Editor despues de 035 y rf04-c-preflight.sql.
-- Solo reemplaza la lectura de detalle; no modifica datos, ventanas ni otras RPC.
begin;
set local lock_timeout = '5s';

do $rf04_c$
declare p record; sig text := 'public.admin_instructor_rating_detail(uuid,uuid,integer,integer)';
begin
  select f.*, l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
    where f.oid=to_regprocedure(sig);
  if not found then raise exception 'Falta funcion 035: %',sig; end if;
  if md5(replace(p.prosrc,E'\r','')) <> '75db43164901732011d52359026f8e6d'
    or p.prorettype <> 'jsonb'::regtype or p.proretset or p.prokind <> 'f'
    or p.proargnames is distinct from array['p_actor','p_instructor','p_page','p_page_size']::text[]
    or p.pronargdefaults <> 2 or pg_get_expr(p.proargdefaults,0) is distinct from '1, 20'
    or p.prosecdef or p.provolatile <> 's' or p.lanname <> 'plpgsql'
    or p.proconfig is distinct from array['search_path=""']::text[] then
    raise exception 'Definicion inesperada de %; se requiere la version exacta de 035',sig;
  end if;
  if to_regclass('public.users') is null or to_regclass('public.practice_slots') is null
    or to_regclass('public.practice_ratings') is null then
    raise exception 'Faltan tablas de RF-04; aplicar y verificar 035 primero';
  end if;
  if not has_function_privilege('service_role',p.oid,'EXECUTE')
    or has_function_privilege('anon',p.oid,'EXECUTE')
    or has_function_privilege('authenticated',p.oid,'EXECUTE')
    or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee not in (p.proowner,(select oid from pg_roles where rolname='service_role'))) then
    raise exception 'Permisos inesperados de %; se espera solo propietario y service_role',sig;
  end if;
end;
$rf04_c$;

create or replace function public.admin_instructor_rating_detail(p_actor uuid, p_instructor uuid, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists(select 1 from public.users where id = p_actor and activo and rol = 'admin') then
    raise exception 'Solo el administrador puede consultar calificaciones' using errcode = 'RT403'; end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Paginacion invalida' using errcode = '22023'; end if;
  if not exists(select 1 from public.users where id = p_instructor and rol = 'instructor') then
    raise exception 'Instructor no encontrado' using errcode = 'RT404'; end if;
  with matched as materialized (
    select r.id, r.score, r.comment, r.created_at
    from public.practice_ratings r join public.practice_slots s on s.id = r.practice_slot_id
    where r.instructor_id = p_instructor and r.invalidated_at is null and s.attended is true
      and s.status = 'completado' and s.student_id = r.student_id and s.instructor_id = r.instructor_id
  ), stats as (
    select avg(score) as average, count(*) as responses from matched
  ), score_counts as (
    select score, count(*) as responses from matched group by score
  ), star_rows as (
    select g.stars, coalesce(c.responses,0) as responses
    from pg_catalog.generate_series(1,5) g(stars) left join score_counts c on c.score=g.stars
  ), page_rows as (
    select * from matched order by created_at desc, id desc limit p_page_size offset (p_page - 1) * p_page_size
  )
  -- No exponer alumno, franja, cohorte, horarios ni IDs que permitan cruzar la respuesta.
  select jsonb_build_object('instructorId', p_instructor, 'average', round(st.average, 2),
    'responses', st.responses, 'rankingEligible', st.responses >= 3,
    'label', case when st.responses >= 3 then null else 'pocas calificaciones' end,
    'distribution', (select jsonb_agg(jsonb_build_object('stars', stars, 'count', responses,
      'percentage', case when st.responses=0 then 0::numeric else round(responses*100.0/st.responses,2) end)
      order by stars desc) from star_rows),
    'items', coalesce((select jsonb_agg(jsonb_build_object('score', score, 'comment', comment)
      order by created_at desc, id desc) from page_rows), '[]'::jsonb),
    'total', st.responses, 'page', p_page, 'pageSize', p_page_size) into v_result from stats st;
  return v_result;
end;
$$;

revoke all on function public.admin_instructor_rating_detail(uuid,uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.admin_instructor_rating_detail(uuid,uuid,integer,integer) to service_role;
notify pgrst, 'reload schema';
commit;
