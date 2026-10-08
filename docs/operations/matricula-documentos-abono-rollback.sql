-- Reversión manual de 022. Ejecutar solo tras revisar los datos y desplegar
-- coordinadamente el backend anterior. No se aplica automáticamente.
begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog, public, extensions, pg_temp;
lock table public.enrollments in access exclusive mode;
lock table public.enrollment_documents in access exclusive mode;

-- Las marcas hechas por un administrador son información de negocio.
-- No eliminar el checklist si alguna existe: exportar y resolver antes.
do $$
begin
  if exists(select 1 from public.enrollment_documents
      where estado = 'entregado' or marcado_por is not null or fecha_marcado is not null)
     or exists(select 1 from public.enrollment_documents d
       join public.enrollments e on e.id=d.enrollment_id
       join public.users u on u.id=e.student_id
       where d.estado='no_aplica' and not (
         d.tipo='papeleta_votacion' and u.fecha_nacimiento is not null and
         date_part('year',age((clock_timestamp() at time zone 'America/Guayaquil')::date,
                               u.fecha_nacimiento)) >= 65)) then
    raise exception 'Rollback 022 detenido: existen marcas de documentos que se perderían'
      using errcode='55000';
  end if;
end;
$$;

drop function public.update_manual_enrollment_details(uuid,uuid,jsonb,jsonb);
drop function public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb);
create function public.commit_manual_enrollment(
  p_id uuid, p_worker uuid, p_student uuid, p_profile jsonb, p_course uuid,
  p_cohort uuid, p_plan jsonb, p_scheduled_ats timestamptz[], p_instructor uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare op public.manual_enrollment_operations; c public.cohorts;
  e public.enrollments; v_type public.course_type; v_slots integer := 0; v_response jsonb;
begin
  select * into op from public.manual_enrollment_operations where id=p_id for update;
  if not found or op.phase <> 'processing' or op.worker_id <> p_worker then
    raise exception 'Operación no reservada por este proceso' using errcode='CD021';
  end if;
  if not exists(select 1 from public.users where id=op.actor_id and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  select tipo into strict v_type from public.courses where id=p_course;
  if p_cohort is not null then
    select * into strict c from public.cohorts where id=p_cohort for update;
    if c.course_id <> p_course then raise exception 'Cohorte de otro curso' using errcode='CD020'; end if;
    if (clock_timestamp() at time zone 'America/Guayaquil')::date
      not between c.fecha_inicio_matricula and c.fecha_fin_matricula then
      raise exception 'La matrícula de la cohorte ya no está abierta' using errcode='CD020';
    end if;
  elsif cardinality(p_scheduled_ats)>0 then
    raise exception 'Una matrícula pendiente no puede generar franjas' using errcode='CD020';
  end if;
  if p_profile is not null then
    if op.student_id is distinct from p_student or not op.student_created then
      raise exception 'Cuenta nueva no registrada en la operación' using errcode='CD021';
    end if;
    insert into public.users(id,cedula,nombre_completo,telefono,rol,debe_cambiar_password)
    values(p_student,p_profile->>'cedula',p_profile->>'nombreCompleto',nullif(p_profile->>'telefono',''),
      'estudiante',true);
  elsif op.student_created then
    raise exception 'Falta perfil de la cuenta nueva' using errcode='CD021';
  end if;
  insert into public.enrollments(student_id,course_id,course_type,cohort_id,status,monto_total,practice_plan)
    values(p_student,p_course,v_type,p_cohort,
      case when p_cohort is null then 'pendiente_cohorte'::public.enrollment_status else 'activo'::public.enrollment_status end,
      case when p_cohort is null then null else c.precio end,p_plan) returning * into e;
  if cardinality(p_scheduled_ats)>0 then
    insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status)
      select p_cohort,p_instructor,p_student,t,60,'asignado' from unnest(p_scheduled_ats) t;
    get diagnostics v_slots = row_count;
  end if;
  v_response := jsonb_build_object('operationId',p_id,'studentId',p_student,'studentCreated',op.student_created,
    'enrollmentId',e.id,'courseId',p_course,'courseType',v_type,'cohortId',p_cohort,'status',e.status,
    'slotsCreated',v_slots,'plan',p_plan);
  update public.manual_enrollment_operations set phase='committed',response=v_response,
    student_id=p_student,updated_at=now() where id=p_id;
  return v_response;
end $$;
revoke all on function public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid)
  from public,anon,authenticated;
grant execute on function public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid)
  to service_role;
drop trigger enrollments_initialize_documents on public.enrollments;
drop function public.initialize_enrollment_documents();
drop table public.enrollment_documents;
alter table public.enrollments drop constraint enrollments_pending_discount_zero;
notify pgrst, 'reload schema';
commit;
