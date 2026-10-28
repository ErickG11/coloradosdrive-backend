-- SQL Editor. Retira SOLO 036; restaura exactamente la funcion de detalle de 035.
-- No borra respuestas ni modifica otra funcion. Coordinar con la version del backend.
begin;
set local lock_timeout = '5s';
do $rf04_c_rollback$
declare p record;
begin
  select * into p from pg_proc where oid=to_regprocedure('public.admin_instructor_rating_detail(uuid,uuid,integer,integer)');
  if not found then raise exception 'Falta la funcion de detalle 036'; end if;
  if md5(replace(p.prosrc,E'\r','')) <> '1dc9accc7e7fcb85e8ebe28ae362c607'
    or p.prosecdef or p.provolatile <> 's'
    or p.proconfig is distinct from array['search_path=""']::text[] then
    raise exception 'La funcion no es la version esperada de 036; no se reemplaza'; end if;
end;
$rf04_c_rollback$;

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
  ), page_rows as (
    select * from matched order by created_at desc, id desc limit p_page_size offset (p_page - 1) * p_page_size
  )
  -- No exponer alumno, franja, cohorte, horarios ni IDs que permitan cruzar la respuesta.
  select jsonb_build_object('instructorId', p_instructor, 'average', round(avg(score), 2),
    'responses', count(*), 'rankingEligible', count(*) >= 3,
    'label', case when count(*) >= 3 then null else 'pocas calificaciones' end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('score', score, 'comment', comment)
      order by created_at desc, id desc) from page_rows), '[]'::jsonb),
    'total', count(*), 'page', p_page, 'pageSize', p_page_size) into v_result from matched;
  return v_result;
end;
$$;

revoke all on function public.admin_instructor_rating_detail(uuid,uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.admin_instructor_rating_detail(uuid,uuid,integer,integer) to service_role;
do $$ begin
  if (select md5(replace(prosrc,E'\r','')) from pg_proc
    where oid='public.admin_instructor_rating_detail(uuid,uuid,integer,integer)'::regprocedure)
      <> '75db43164901732011d52359026f8e6d' then
    raise exception 'No se restauro el cuerpo exacto de 035'; end if;
end $$;
notify pgrst, 'reload schema';
commit;
