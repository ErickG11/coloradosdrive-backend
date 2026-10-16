-- 028: búsqueda y resumen de requisitos. Entregar a Erick; NO aplicar automáticamente.
begin;
set local lock_timeout = '5s';

-- Normalización Unicode NFD: elimina marcas combinadas sin extensiones ni índices nuevos.
create function public.student_search_key(p_text text)
returns text language sql immutable security invoker set search_path='' as $$
  select lower(regexp_replace(normalize(coalesce(p_text,''), NFD), U&'[\0300-\036f]', '', 'g'));
$$;

-- Cinco categorías por alumno, sobre las matrículas coincidentes del listado.
-- Saldo pendiente NO implica mora: no hay calendario de vencimientos.
create function public.student_requirements(p_enrollments jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  with checks as (
    select bool_and(e.cohort_id is not null) as cohort,
      bool_and(not exists (
        select 1 from unnest(array['cedula','papeleta_votacion','tipo_sangre','titulo_bachiller']) t(tipo)
        where not exists(select 1 from public.enrollment_documents d
          where d.enrollment_id=e.id and d.tipo=t.tipo and d.estado in ('entregado','no_aplica'))
      )) as documents,
      case when bool_and(coalesce(e.monto_abonado>=e.monto_total,false)) then true
        else null end as payments,
      bool_and(exists(select 1 from public.exams x
          where x.course_id=e.course_id and x.type='definitivo' and x.is_published)
        and not exists(select 1 from public.exams x
          where x.course_id=e.course_id and x.type='definitivo' and x.is_published
            and not exists(select 1 from public.exam_attempts a where a.exam_id=x.id
              and a.student_id=e.student_id and a.status='completado' and a.passed))) as exams,
      case when bool_or(e.horas_practica_objetivo is null) then null else
        bool_and(coalesce((select sum(s.duration_minutes) from public.practice_slots s
          where s.student_id=e.student_id and s.cohort_id=e.cohort_id
            and s.status='completado' and s.attended),0)>=e.horas_practica_objetivo*60)
      end as practice
    from public.enrollments e
    where e.id in (select (j->>'id')::uuid from jsonb_array_elements(p_enrollments) j)
  )
  select jsonb_build_object(
    'pending',to_jsonb(array_remove(array[
      case when not cohort then 'Cohorte asignada' end,
      case when not documents then 'Documentos entregados' end,
      case when not exams then 'Exámenes definitivos aprobados' end,
      case when not practice then 'Horas de práctica cubiertas' end],null)),
    'unavailable',to_jsonb(array_remove(array[
      case when cohort is null then 'Cohorte asignada' end,
      case when documents is null then 'Documentos entregados' end,
      case when payments is null then 'Pagos al día: sin calendario de vencimientos' end,
      case when exams is null then 'Exámenes definitivos aprobados' end,
      case when practice is null then 'Horas de práctica: sin objetivo registrado' end],null)))
  from checks;
$$;

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
      'usedCapacity',(select count(*) from public.enrollments e
        where e.cohort_id=c.id and e.status='activo'),
      'totalCapacity',c.cupo_maximo) from public.cohorts c where c.id=p_cohort)) into v_result;
  return v_result;
end $$;


revoke all on function public.student_search_key(text), public.student_requirements(jsonb),
  public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)
  from public,anon,authenticated;
grant execute on function public.student_search_key(text), public.student_requirements(jsonb),
  public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)
  to service_role;
notify pgrst,'reload schema';
commit;
