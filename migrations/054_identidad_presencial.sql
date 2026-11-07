-- F19. MANUAL, después de 042 (y de las migraciones previas del flujo). Confirmación presencial
-- de la cédula original por el instructor de la franja; atómica, idempotente y auditada.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regclass('public.practice_slots') is null or to_regclass('public.solicitud_auditoria') is null
  or to_regclass('public.solicitudes_inscripcion') is null or to_regclass('public.solicitud_documentos') is null
  or not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='enrollments' and column_name='identidad_presencial_por')
  or not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='enrollments' and column_name='certificado_original_visto')
 then raise exception '054 requiere la migración 042 completa';end if;
end $$;

-- ¿El alumno ingresó con certificado de estudios? Niveles que lo exigen, o certificado subido.
create or replace function public.certificado_original_requerido(p_student uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.solicitudes_inscripcion s
  where s.student_id=p_student and s.estado='aprobada'
   and (s.nivel_estudios in ('bachiller_exterior','decimo_aprobado','cursando_bachillerato')
    or exists(select 1 from public.solicitud_documentos d
     where d.solicitud_id=s.id and d.tipo_documento='certificado_estudios')))
$$;
revoke all on function public.certificado_original_requerido(uuid) from public,anon,authenticated;
grant execute on function public.certificado_original_requerido(uuid) to service_role;

-- Franjas del instructor cuyo alumno viene de solicitud y aún no tiene identidad confirmada,
-- dentro de la ventana: desde 30 minutos antes del inicio hasta 48 h después del fin.
create or replace function public.franjas_identidad_pendiente(p_instructor uuid,p_slots uuid[])
returns table(slot_id uuid,certificado_requerido boolean)
language sql stable security invoker set search_path='' as $$
 select s.id,public.certificado_original_requerido(s.student_id)
 from public.practice_slots s
 where s.id=any(p_slots) and s.instructor_id=p_instructor and s.student_id is not null
  and s.status in ('confirmado','completado')
  and clock_timestamp() between s.scheduled_at-interval '30 minutes'
   and s.scheduled_at+make_interval(mins=>s.duration_minutes)+interval '48 hours'
  and exists(select 1 from public.enrollments e where e.student_id=s.student_id
   and e.cohort_id=s.cohort_id and e.origen='solicitud' and e.status='activo'
   and e.identidad_presencial_at is null)
$$;
revoke all on function public.franjas_identidad_pendiente(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.franjas_identidad_pendiente(uuid,uuid[]) to service_role;

-- Una sola transición. Repetir sobre una identidad ya confirmada no escribe nada
-- (transicion=false) y conserva la primera confirmación.
create or replace function public.confirmar_identidad_presencial(
 p_slot uuid,p_instructor uuid,p_certificado_visto boolean)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare s public.practice_slots;e public.enrollments;v_req boolean;v_vista boolean;v_sol uuid;v_now timestamptz;
begin
 perform 1 from public.users where id=p_instructor and rol='instructor' and activo for share;
 if not found then raise exception 'Cuenta de instructor no válida' using errcode='IP403';end if;
 select * into s from public.practice_slots where id=p_slot for update;
 if not found or s.instructor_id<>p_instructor then
  raise exception 'Franja no encontrada' using errcode='IP404';end if;
 if s.student_id is null or s.status not in ('confirmado','completado') then
  raise exception 'La franja no tiene un alumno confirmado' using errcode='IP409';end if;
 v_now:=clock_timestamp();
 if v_now<s.scheduled_at-interval '30 minutes'
  or v_now>s.scheduled_at+make_interval(mins=>s.duration_minutes)+interval '48 hours' then
  raise exception 'Fuera de la ventana de asistencia' using errcode='IP410';end if;
 select * into e from public.enrollments where student_id=s.student_id and cohort_id=s.cohort_id
  and origen='solicitud' and status='activo' order by created_at desc limit 1 for update;
 if not found then raise exception 'El alumno no proviene de una solicitud' using errcode='IP412';end if;
 if e.identidad_presencial_at is not null then
  return jsonb_build_object('transicion',false,'confirmadaAt',e.identidad_presencial_at,
   'certificadoOriginalVisto',e.certificado_original_visto);end if;
 v_req:=public.certificado_original_requerido(s.student_id);
 v_vista:=v_req and coalesce(p_certificado_visto,false);
 update public.enrollments set identidad_presencial_at=v_now,identidad_presencial_por=p_instructor,
  certificado_original_visto=v_vista where id=e.id;
 select id into v_sol from public.solicitudes_inscripcion where student_id=s.student_id and estado='aprobada' limit 1;
 if v_sol is not null then
  insert into public.solicitud_auditoria(solicitud_id,actor_id,accion)
  values(v_sol,p_instructor,'identidad_presencial_confirmada');end if;
 return jsonb_build_object('transicion',true,'confirmadaAt',v_now,'certificadoOriginalVisto',v_vista);
end $$;
revoke all on function public.confirmar_identidad_presencial(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.confirmar_identidad_presencial(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
