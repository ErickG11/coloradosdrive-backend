-- MANUAL: detener backend nuevo; conserva datos. Aborta si existen etapas no reversibles.
begin;
set local lock_timeout='5s';
lock table public.enrollments in access exclusive mode;
do $$ begin
 if exists(select 1 from public.enrollments where etapa_inscripcion<>'activa' or reserva_expira_at is not null) then
 raise exception 'Hay matrículas nuevas por agendar/reservadas: reconciliar antes del rollback, no se modificaron';end if;
end $$;
drop trigger if exists enrollments_01_solicitud_stage on public.enrollments;
drop trigger if exists cohorts_reserved_capacity on public.cohorts;
drop function if exists public.guard_new_solicitud_enrollment();
drop function if exists public.guard_cohort_reserved_capacity();
drop trigger if exists enrollments_enforce_cupo on public.enrollments;
create or replace function public.finalizar_aprobacion_inscripcion(
  p_id uuid,p_actor uuid,p_claim timestamptz,p_student uuid,p_cohort uuid,p_estado text,p_monto numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;v_enrollment uuid;
begin
 if p_estado is null or p_estado not in ('activo','pendiente_cohorte')
  or (p_estado='activo' and p_cohort is null) or (p_estado='pendiente_cohorte' and p_cohort is not null) then
  raise exception 'Matrícula inválida' using errcode='22023';end if;
 select * into s from public.solicitudes_inscripcion where id=p_id and estado='enviada'
  and reviewed_by=p_actor and reviewed_at=p_claim for update;
 if not found then raise exception 'La solicitud está cerrada o en resolución' using errcode='SI409';end if;
 insert into public.users(id,cedula,nombre_completo,telefono,fecha_nacimiento,rol,status,debe_cambiar_password,
  tipo_sangre,ciudadania)
 values(p_student,s.cedula,s.nombre_completo,s.telefono,s.fecha_nacimiento,'estudiante','verificado',false,
  case when s.tipo_sangre='no_sabe' then null else s.tipo_sangre end,
  case s.nacionalidad_tipo when 'ecuatoriana' then 'Ecuatoriana' else 'Extranjera' end);
 insert into public.enrollments(student_id,course_id,cohort_id,status,monto_total,origen,requisitos_verificados_at)
 values(p_student,s.course_id,p_cohort,p_estado::public.enrollment_status,p_monto,'solicitud',clock_timestamp())
 returning id into v_enrollment;
 -- El trigger de matrícula crea las cuatro filas del checklist; el original del certificado solo aplica
 -- si el postulante presentó uno.
 if not exists(select 1 from public.solicitud_documentos where solicitud_id=p_id and tipo_documento='certificado_estudios') then
  update public.enrollment_documents set estado='no_aplica' where enrollment_id=v_enrollment and tipo='titulo_bachiller';
 end if;
 update public.solicitudes_inscripcion set estado='aprobada',student_id=p_student,motivo_rechazo=null where id=p_id;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(p_id,p_actor,'solicitud_aprobada');
 return jsonb_build_object('studentId',p_student,'enrollmentId',v_enrollment);
end $$;
create or replace function public.assign_pending_enrollment_cohort(
  p_actor uuid, p_student uuid, p_enrollment uuid, p_cohort uuid,
  p_cohort_version timestamptz, p_validated_day date
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.enrollments; c public.cohorts; v_active boolean; v_net numeric;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  if p_actor is null or p_student is null or p_enrollment is null or p_cohort is null then
    raise exception 'Asignación inválida' using errcode='22023'; end if;

  -- Mismo orden que B/D: alumno antes de matrícula; cohorte al final.
  select activo into v_active from public.users
    where id=p_student and rol='estudiante' for share;
  if not found then raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
  perform private.assert_student_not_deleting(p_student);
  if not v_active then raise exception 'Cuenta inactiva' using errcode='CD403'; end if;
  select * into e from public.enrollments
    where id=p_enrollment and student_id=p_student for update;
  if not found then raise exception 'Matrícula no encontrada' using errcode='CD040'; end if;
  if e.status='activo' and e.cohort_id=p_cohort then return to_jsonb(e); end if;
  if e.status<>'pendiente_cohorte' then
    raise exception 'La matrícula ya no está pendiente de cohorte' using errcode='CD041'; end if;

  select * into c from public.cohorts where id=p_cohort for update;
  if not found then raise exception 'Cohorte no encontrada' using errcode='CD042'; end if;
  if c.course_id<>e.course_id then
    raise exception 'La cohorte no corresponde al curso' using errcode='CD043'; end if;
  if p_cohort_version is null or p_validated_day is null then
    raise exception 'Falta validación de ventana' using errcode='22023'; end if;
  -- Reloj leído DESPUÉS de esperar todos los locks. No repetir el predicado de ventana.
  if c.updated_at is distinct from p_cohort_version or
    (clock_timestamp() at time zone 'America/Guayaquil')::date is distinct from p_validated_day then
    raise exception 'La cohorte o el día cambiaron; recarga antes de confirmar' using errcode='CD044'; end if;
  v_net:=c.precio-e.descuento;
  if v_net<0 or e.monto_abonado>v_net then
    raise exception 'El abono supera el neto de la cohorte' using errcode='CD045'; end if;
  -- El trigger enforce_cohort_cupo revalida cupo bajo este mismo lock (CD001).
  update public.enrollments set cohort_id=p_cohort,status='activo',monto_total=v_net,
    cohort_assigned_by=p_actor,cohort_assigned_at=clock_timestamp()
    where id=e.id returning * into e;
  return to_jsonb(e);
end $$;
create or replace function public.student_requirements(p_enrollments jsonb)
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
create or replace function public.enforce_cohort_cupo()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_cupo integer;
  v_ocupados integer;
begin
  -- Una fila pendiente_cohorte (cohort_id null) o que no queda 'activo'
  -- (finalizado/retirado) no consume cupo de ninguna cohorte.
  if NEW.cohort_id is null or NEW.status <> 'activo' then
    return NEW;
  end if;

  -- En UPDATE, si ni cohort_id ni status cambiaron, no hay nada que
  -- reverificar (evita re-lockear/recontar en cada UPDATE no relacionado).
  if TG_OP = 'UPDATE'
     and NEW.cohort_id is not distinct from OLD.cohort_id
     and NEW.status is not distinct from OLD.status then
    return NEW;
  end if;

  select cupo_maximo into v_cupo
  from public.cohorts
  where id = NEW.cohort_id
  for update;

  if not found then
    raise exception 'La cohorte % no existe', NEW.cohort_id;
  end if;

  select count(*) into v_ocupados
  from public.enrollments
  where cohort_id = NEW.cohort_id
    and status = 'activo'
    and id <> NEW.id;

  if v_ocupados >= v_cupo then
    -- Código de error propio (no colisiona con ningún SQLSTATE estándar
    -- de Postgres) para que la capa de aplicación lo distinga de
    -- cualquier otra violación de constraint y lo traduzca a un 409 claro.
    raise exception 'La cohorte % ya alcanzó su cupo máximo (%)', NEW.cohort_id, v_cupo
      using errcode = 'CD001';
  end if;

  return NEW;
end;
$$;
create trigger enrollments_enforce_cupo before insert or update of cohort_id,status on public.enrollments
 for each row execute function public.enforce_cohort_cupo();
drop function if exists public.cohort_cupos_ocupados(uuid[]);
drop function if exists public.cohort_cupo_ocupado(uuid,uuid);
alter table public.enrollments drop constraint if exists enrollments_pendiente_cohorte_shape;
alter table public.enrollments add constraint enrollments_pendiente_cohorte_shape check (
 (status='pendiente_cohorte' and cohort_id is null and monto_total is null) or
 (status<>'pendiente_cohorte' and cohort_id is not null and monto_total is not null));
alter table public.enrollments drop constraint if exists enrollments_etapa_valida;
drop index if exists public.enrollments_reserva_cupo_idx;
alter table public.enrollments drop column etapa_inscripcion,drop column reserva_expira_at;
notify pgrst,'reload schema';
commit;
