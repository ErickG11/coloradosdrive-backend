-- Corrección de052: p_estado es text; enrollments.status es un enum. MANUAL después de055.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)') is null
 or to_regprocedure('public.guard_aprobacion_intento()') is null then
 raise exception '057 requiere052 y055 completas';end if;
 if (select md5(prosrc) from pg_proc where oid='public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)'::regprocedure) not in ('26561c80450d360b8f72e922b1b43b16','eb7ce49216753f407932801a313a7514') then
 raise exception 'Cuerpo de aprobación distinto del revisado: no se modifica; comparar cambios manuales';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.enrollments'::regclass
 and attname='status' and atttypid='public.enrollment_status'::regtype and not attisdropped) then
 raise exception 'enrollments.status no tiene el tipo esperado';end if;
 if not exists(select 1 from pg_enum where enumtypid='public.enrollment_status'::regtype and enumlabel='activo')
 or not exists(select 1 from pg_enum where enumtypid='public.enrollment_status'::regtype and enumlabel='pendiente_cohorte') then
 raise exception 'Faltan estados de matrícula';end if;
end $$;
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
revoke all on function public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric) to service_role;
notify pgrst,'reload schema';
commit;
