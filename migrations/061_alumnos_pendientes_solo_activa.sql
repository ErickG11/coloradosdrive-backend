-- I13/H7. MANUAL después de060. Solo cambia el filtro; no actualiza alumnos/matrículas.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)') is null or not exists(select 1 from pg_attribute where attrelid='public.enrollments'::regclass and attname='etapa_inscripcion' and not attisdropped) then
 raise exception '061 requiere058 y listado Alumnos completo';end if;
 if (select md5(prosrc) from pg_proc where oid='public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'::regprocedure) not in ('210f8316c6b29e4e640d965a1659ef9a','3ed6c97552c91eec1b7bad345c8e3525') then
 raise exception '061: cuerpo de listado distinto del revisado; no modificar sin reconciliar';end if;
end $$;
create or replace function public.list_admin_students(
  p_actor uuid, p_q text default null, p_active boolean default null,
  p_course uuid default null, p_cohort uuid default null,
  p_pending boolean default null, p_documents_pending boolean default null,
  p_history boolean default false, p_page integer default 1, p_page_size integer default 20
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_filtered boolean; v_q text;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  if p_page is null or p_page not between 1 and 100000
     or p_page_size is null or p_page_size not between 1 and 100
     or p_history is null or length(coalesce(p_q,'')) > 80 then
    raise exception 'Paginación o filtros inválidos' using errcode='22023';
  end if;
  v_q := public.student_search_key(btrim(coalesce(p_q,'')));
  v_filtered := p_course is not null or p_cohort is not null
    or p_pending is not null or p_documents_pending is not null;
  with matched as materialized (
    select u.id,u.cedula,u.nombre_completo,u.telefono,u.activo,u.created_at,
      m.enrollments
    from public.users u
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'courseId',e.course_id,
        'courseType',e.course_type,'cohortId',e.cohort_id,'status',e.status,'origen',e.origen,'etapa',e.etapa_inscripcion)
        order by e.fecha_inscripcion desc,e.id),'[]'::jsonb) as enrollments
      from public.enrollments e
      where e.student_id=u.id
        and (p_history or public.student_enrollment_is_current(e.status))
        and (p_course is null or e.course_id=p_course)
        and (p_cohort is null or e.cohort_id=p_cohort)
        and (p_pending is null or (e.etapa_inscripcion='activa' and (e.status='pendiente_cohorte')=p_pending))
        and (p_documents_pending is null or exists(
          select 1 from public.enrollment_documents d
          where d.enrollment_id=e.id and d.estado='pendiente'
        )=p_documents_pending)
    ) m
    where u.rol='estudiante' and (p_active is null or u.activo=p_active)
      and (v_q='' or
        position(v_q in public.student_search_key(u.nombre_completo))>0 or
        position(v_q in public.student_search_key(u.cedula))>0 or
        position(v_q in public.student_search_key(u.telefono))>0)
      and (not v_filtered or jsonb_array_length(m.enrollments)>0)
  ), page_rows as (
    select * from matched order by nombre_completo,id
      limit p_page_size offset (p_page-1)*p_page_size
  )
  select jsonb_build_object('items',coalesce((
    select jsonb_agg(jsonb_build_object('id',id,'cedula',cedula,
      'nombreCompleto',nombre_completo,'telefono',telefono,'activo',activo,
      'createdAt',created_at,'matchingEnrollments',enrollments,
      'requirements',public.student_requirements(enrollments))
      order by nombre_completo,id) from page_rows
  ),'[]'::jsonb),'total',(select count(*) from matched),
    'page',p_page,'pageSize',p_page_size,
    'cohortSummary',(select jsonb_build_object('id',c.id,'name',c.nombre,
      'activeStudents',(select count(distinct e.student_id) from public.enrollments e
        join public.users u on u.id=e.student_id
        where e.cohort_id=c.id and e.status='activo' and u.rol='estudiante' and u.activo),
      'matchingActiveStudents',(select count(*) from matched m where m.activo and exists(
        select 1 from public.enrollments e where e.student_id=m.id and e.cohort_id=c.id and e.status='activo')),
      'usedCapacity',public.cohort_cupo_ocupado(c.id),
      'totalCapacity',c.cupo_maximo) from public.cohorts c where c.id=p_cohort)) into v_result;
  return v_result;
end $$;
revoke all on function public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
