-- Restaurar primero la RPC anterior; no cambia tablas ni RLS.
begin;
set local lock_timeout = '5s';
create or replace function public.list_admin_students(
  p_actor uuid, p_q text default null, p_active boolean default null,
  p_course uuid default null, p_cohort uuid default null,
  p_pending boolean default null, p_documents_pending boolean default null,
  p_history boolean default false, p_page integer default 1, p_page_size integer default 20
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_filtered boolean;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  if p_page is null or p_page not between 1 and 100000
     or p_page_size is null or p_page_size not between 1 and 100
     or p_history is null or length(coalesce(p_q,'')) > 80 then
    raise exception 'Paginación o filtros inválidos' using errcode='22023';
  end if;
  v_filtered := p_course is not null or p_cohort is not null
    or p_pending is not null or p_documents_pending is not null;
  with matched as materialized (
    select u.id,u.cedula,u.nombre_completo,u.telefono,u.activo,u.created_at,
      m.enrollments
    from public.users u
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'courseId',e.course_id,
        'courseType',e.course_type,'cohortId',e.cohort_id,'status',e.status)
        order by e.fecha_inscripcion desc,e.id),'[]'::jsonb) as enrollments
      from public.enrollments e
      where e.student_id=u.id
        and (p_history or public.student_enrollment_is_current(e.status))
        and (p_course is null or e.course_id=p_course)
        and (p_cohort is null or e.cohort_id=p_cohort)
        and (p_pending is null or (e.status='pendiente_cohorte')=p_pending)
        and (p_documents_pending is null or exists(
          select 1 from public.enrollment_documents d
          where d.enrollment_id=e.id and d.estado='pendiente'
        )=p_documents_pending)
    ) m
    where u.rol='estudiante' and (p_active is null or u.activo=p_active)
      and (coalesce(p_q,'')='' or
        position(lower(p_q) in lower(u.nombre_completo))>0 or
        position(p_q in u.cedula)>0 or
        position(p_q in coalesce(u.telefono,''))>0)
      and (not v_filtered or jsonb_array_length(m.enrollments)>0)
  ), page_rows as (
    select * from matched order by nombre_completo,id
      limit p_page_size offset (p_page-1)*p_page_size
  )
  select jsonb_build_object('items',coalesce((
    select jsonb_agg(jsonb_build_object('id',id,'cedula',cedula,
      'nombreCompleto',nombre_completo,'telefono',telefono,'activo',activo,
      'createdAt',created_at,'matchingEnrollments',enrollments)
      order by nombre_completo,id) from page_rows
  ),'[]'::jsonb),'total',(select count(*) from matched),
    'page',p_page,'pageSize',p_page_size) into v_result;
  return v_result;
end $$;

drop function public.student_requirements(jsonb);
drop function public.student_search_key(text);
notify pgrst,'reload schema';
commit;
