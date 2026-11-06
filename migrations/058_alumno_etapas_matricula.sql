-- I02/H7. MANUAL después de057; NO reescribe estados, cohortes ni importes existentes.
begin;
set local lock_timeout='5s';
do $$ declare f text;t text;begin
 foreach f in array array['public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)',
 'public.guard_aprobacion_intento()','public.confirmar_identidad_presencial_admin(uuid,uuid,text)',
 'public.enforce_cohort_cupo()','public.initialize_enrollment_documents()','public.enrollment_resolve_course()',
 'public.enforce_enrollment_student_role()'] loop
 if to_regprocedure(f) is null then raise exception '058 requiere objeto % (020/022/055/056/057)',f;end if;end loop;
 if position('p_estado::public.enrollment_status' in (select prosrc from pg_proc where oid='public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)'::regprocedure))=0 then
 raise exception '058 requiere la corrección057 aplicada';end if;
 foreach t in array array['enrollments_enforce_cupo','enrollments_initialize_documents','enrollments_00_resolve_course','enrollments_enforce_student_role'] loop
 if not exists(select 1 from pg_trigger where tgrelid='public.enrollments'::regclass and tgname=t and not tgisinternal) then raise exception 'Falta disparador %',t;end if;end loop;
end $$;

alter table public.enrollments add column if not exists etapa_inscripcion text not null default 'activa',
 add column if not exists reserva_expira_at timestamptz;
comment on column public.enrollments.etapa_inscripcion is
 'Etapa independiente del status administrativo. Manuales y existentes: activa. Nuevas solicitudes: por_agendar. I05 gestiona reservado; I10 activa al pagar.';
comment on column public.enrollments.reserva_expira_at is
 'Autoridad temporal del cupo reservado; I05/I08 gestionan franjas y vencimiento. Una reserva vencida nunca cuenta, incluso con cron apagado.';
alter table public.enrollments drop constraint if exists enrollments_etapa_valida;
alter table public.enrollments add constraint enrollments_etapa_valida check (
 etapa_inscripcion in ('por_agendar','reservado','activa') and
 (origen='solicitud' or etapa_inscripcion='activa'));
alter table public.enrollments drop constraint if exists enrollments_pendiente_cohorte_shape;
alter table public.enrollments add constraint enrollments_pendiente_cohorte_shape check (
 (etapa_inscripcion='activa' and reserva_expira_at is null and
   ((status='pendiente_cohorte' and cohort_id is null and monto_total is null)
    or (status<>'pendiente_cohorte' and cohort_id is not null and monto_total is not null)))
 or (origen='solicitud' and etapa_inscripcion in ('por_agendar','reservado')
  and status='pendiente_cohorte' and monto_total is null and monto_abonado=0 and descuento=0
  and ((etapa_inscripcion='por_agendar' and cohort_id is null and reserva_expira_at is null)
   or (etapa_inscripcion='reservado' and cohort_id is not null and reserva_expira_at is not null
    and isfinite(reserva_expira_at)))));
create index if not exists enrollments_reserva_cupo_idx on public.enrollments(cohort_id,reserva_expira_at)
 where etapa_inscripcion='reservado';
-- Se conservan enrollment_resolve_course, student_role y el checklist022 sin cambios.
alter table public.enrollments enable row level security;
revoke all on public.enrollments from public,anon,authenticated;

create or replace function public.cohort_cupo_ocupado(p_cohort uuid,p_excluir uuid default null)
returns bigint language sql volatile security invoker set search_path='' as $$
 select count(*) from public.enrollments e where e.cohort_id=p_cohort
 and (p_excluir is null or e.id<>p_excluir)
 and (e.status='activo' or (e.etapa_inscripcion='reservado' and e.reserva_expira_at>clock_timestamp()))
$$;
create or replace function public.cohort_cupos_ocupados(p_cohorts uuid[])
returns table(cohort_id uuid,ocupados bigint) language sql volatile security invoker set search_path='' as $$
 select c.id,public.cohort_cupo_ocupado(c.id) from (select distinct unnest(p_cohorts) as id) c
$$;
create or replace function public.enforce_cohort_cupo() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_cupo integer;v_ocupados bigint;
begin
 if new.cohort_id is null or not (new.status='activo' or
  (new.etapa_inscripcion='reservado' and new.reserva_expira_at>clock_timestamp())) then return new;end if;
 -- Cohorte bloqueada ANTES de contar. Mismo lock para reserva, pago y matrícula manual.
 select cupo_maximo into v_cupo from public.cohorts where id=new.cohort_id for update;
 if not found then raise exception 'Cohorte no encontrada' using errcode='CD042';end if;
 v_ocupados:=public.cohort_cupo_ocupado(new.cohort_id,new.id);
 if v_ocupados>=v_cupo then raise exception 'Cohorte sin cupo' using errcode='CD001';end if;
 return new;
end $$;
drop trigger if exists enrollments_enforce_cupo on public.enrollments;
create trigger enrollments_enforce_cupo before insert or update of cohort_id,status,etapa_inscripcion,reserva_expira_at
 on public.enrollments for each row execute function public.enforce_cohort_cupo();

create or replace function public.guard_cohort_reserved_capacity() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if new.cupo_maximo<old.cupo_maximo and new.cupo_maximo<public.cohort_cupo_ocupado(old.id) then
 raise exception 'Cupo inferior a matrículas y reservas vigentes' using errcode='IC409';end if;
 return new;
end $$;
drop trigger if exists cohorts_reserved_capacity on public.cohorts;
create trigger cohorts_reserved_capacity before update of cupo_maximo on public.cohorts
 for each row execute function public.guard_cohort_reserved_capacity();

create or replace function public.guard_new_solicitud_enrollment() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if new.origen='solicitud' and (new.etapa_inscripcion<>'por_agendar' or new.cohort_id is not null or new.monto_total is not null) then
 raise exception 'Una aprobación nueva debe quedar por agendar' using errcode='IE409';end if;
 return new;
end $$;
drop trigger if exists enrollments_01_solicitud_stage on public.enrollments;
create trigger enrollments_01_solicitud_stage before insert on public.enrollments
 for each row execute function public.guard_new_solicitud_enrollment();
create or replace function public.finalizar_aprobacion_inscripcion(
  p_id uuid,p_actor uuid,p_claim timestamptz,p_student uuid,p_cohort uuid,p_estado text,p_monto numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;v_enrollment uuid;
begin
 if p_estado is distinct from 'pendiente_cohorte' or p_cohort is not null or p_monto is not null then
  raise exception 'Aprobar no asigna cohorte ni monto; requiere backend I02' using errcode='IE409';end if;
 select * into s from public.solicitudes_inscripcion where id=p_id and estado='enviada'
  and reviewed_by=p_actor and reviewed_at=p_claim for update;
 if not found then raise exception 'La solicitud está cerrada o en resolución' using errcode='SI409';end if;
 insert into public.users(id,cedula,nombre_completo,telefono,fecha_nacimiento,rol,status,debe_cambiar_password,
  tipo_sangre,ciudadania)
 values(p_student,s.cedula,s.nombre_completo,s.telefono,s.fecha_nacimiento,'estudiante','verificado',false,
  case when s.tipo_sangre='no_sabe' then null else s.tipo_sangre end,
  case s.nacionalidad_tipo when 'ecuatoriana' then 'Ecuatoriana' else 'Extranjera' end);
 insert into public.enrollments(student_id,course_id,cohort_id,status,monto_total,origen,requisitos_verificados_at,etapa_inscripcion)
 values(p_student,s.course_id,p_cohort,p_estado::public.enrollment_status,p_monto,'solicitud',clock_timestamp(),'por_agendar')
 returning id into v_enrollment;
 -- El trigger de matrícula crea las cuatro filas del checklist; el original del certificado solo aplica
 -- si el postulante presentó uno.
 if not exists(select 1 from public.solicitud_documentos where solicitud_id=p_id and tipo_documento='certificado_estudios') then
  update public.enrollment_documents set estado='no_aplica' where enrollment_id=v_enrollment and tipo='titulo_bachiller';
 end if;
 update public.solicitudes_inscripcion set estado='aprobada',student_id=p_student,motivo_rechazo=null where id=p_id;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(p_id,p_actor,'solicitud_aprobada');
 return jsonb_build_object('studentId',p_student,'enrollmentId',v_enrollment,'etapa','por_agendar');
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
  if e.origen='solicitud' and e.etapa_inscripcion<>'activa' then
    raise exception 'El alumno debe reservar y pagar antes de asignar cohorte' using errcode='IE403';end if;
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
    select bool_and(e.cohort_id is not null and e.etapa_inscripcion='activa') as cohort,
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
        'courseType',e.course_type,'cohortId',e.cohort_id,'status',e.status,'origen',e.origen,'etapa',e.etapa_inscripcion)
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
      'usedCapacity',public.cohort_cupo_ocupado(c.id),
      'totalCapacity',c.cupo_maximo) from public.cohorts c where c.id=p_cohort)) into v_result;
  return v_result;
end $$;

revoke all on function public.cohort_cupo_ocupado(uuid,uuid),public.cohort_cupos_ocupados(uuid[]),
 public.enforce_cohort_cupo(),public.guard_cohort_reserved_capacity(),public.guard_new_solicitud_enrollment(),
 public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric),
 public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date),public.student_requirements(jsonb),
 public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)
 from public,anon,authenticated;
grant execute on function public.cohort_cupo_ocupado(uuid,uuid),public.cohort_cupos_ocupados(uuid[]),
 public.enforce_cohort_cupo(),public.guard_cohort_reserved_capacity(),public.guard_new_solicitud_enrollment(),
 public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric),
 public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date),public.student_requirements(jsonb),
 public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)
 to service_role;
notify pgrst,'reload schema';
commit;
