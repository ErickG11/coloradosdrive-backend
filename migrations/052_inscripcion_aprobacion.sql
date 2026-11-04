-- F16. MANUAL después de 051. Aprobación en dos pasos atómicos: reclamar y finalizar.
-- La cuenta de Auth se crea entre ambos pasos desde el backend (sin contraseña) y se compensa allí.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.validar_aprobacion_inscripcion(uuid,uuid,uuid,text,text)') is null
  or to_regclass('public.enrollments') is null then
  raise exception '052 requiere 042–051 completas';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='enrollments' and column_name='requisitos_verificados_at') then
  raise exception 'Falta enrollments.requisitos_verificados_at (042)';end if;
end $$;

-- Paso 1: bloquea la solicitud, valida todo y la reclama (reviewed_by/at). Mientras esté
-- reclamada no se puede verificar, devolver, rechazar ni eliminar.
create or replace function public.reclamar_aprobacion_inscripcion(
  p_id uuid,p_actor uuid,p_verif_identidad uuid,p_verif_estudios uuid,p_version_aviso text,p_version_terminos text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;
begin
 if p_actor is null then raise exception 'Actor inválido' using errcode='22023';end if;
 perform 1 from public.solicitudes_inscripcion where id=p_id for update;
 if not found then raise exception 'No existe solicitud' using errcode='SI404';end if;
 perform public.validar_aprobacion_inscripcion(p_id,p_verif_identidad,p_verif_estudios,p_version_aviso,p_version_terminos);
 update public.solicitudes_inscripcion set reviewed_by=p_actor,reviewed_at=clock_timestamp()
  where id=p_id returning * into s;
 return jsonb_build_object('claim',s.reviewed_at,'correo',s.correo,'courseId',s.course_id,
  'solicitadaAt',s.solicitada_at);
end $$;
revoke all on function public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text) to service_role;

-- Paso 2: perfil, matrícula (origen solicitud, requisitos verificados), checklist y estado final
-- en una sola transacción. Si el cupo de la cohorte se agotó (CD001) todo se revierte y el backend
-- reintenta con otra cohorte. tipo_sangre «no_sabe» queda vacío en el perfil (pendiente de carné).
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
 values(p_student,s.course_id,p_cohort,p_estado,p_monto,'solicitud',clock_timestamp())
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
