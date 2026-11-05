-- MANUAL: no destruye un ledger de pagos. Requiere base sin intentos/eventos.
begin;
set local lock_timeout='5s';
do $$ begin if exists(select 1 from public.payments) then raise exception '060 contiene pagos; no borrar historial. Requiere plan de operador';end if;end $$;
create or replace function public.manage_student_reservation(p_student uuid,p_accion text,p_id uuid default null,
 p_extension integer default 10,p_max_extensiones integer default 1,p_gracia integer default 10)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.student_schedule_reservations;v_now timestamptz;v_end timestamptz;begin
 if p_accion is null or p_accion not in ('actual','ampliar','liberar','iniciar_pago') or p_extension is null or p_extension not between 1 and 10
 or p_max_extensiones is null or p_max_extensiones not between 0 and 1 or p_gracia is null or p_gracia not between 1 and 10 then
 raise exception 'Acción inválida' using errcode='22023';end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then raise exception 'Cuenta inactiva' using errcode='IR403';end if;
 perform private.assert_student_not_deleting(p_student);
 perform public.expire_student_reservations(p_student);
 select * into r from public.student_schedule_reservations where student_id=p_student
 and(p_id is null or id=p_id) order by creada_at desc,id limit 1 for update;
 if not found then
 if p_accion='actual' then return null;end if;
 raise exception 'Reserva no encontrada' using errcode='IR404';end if;
 if p_accion='actual' then return private.student_reservation_json(r.id);end if;
 if p_accion='liberar' and r.estado in ('liberada','vencida') then return private.student_reservation_json(r.id);end if;
 if r.estado not in ('vigente','pago_en_curso') then
 -- No excepción tras limpieza: una excepción revertiría la expiración perezosa.
 return private.student_reservation_json(r.id);end if;
 if p_accion='liberar' then
 if r.estado='pago_en_curso' then raise exception 'Hay un pago en curso; espera el resultado' using errcode='IR412';end if;
 perform private.close_student_reservation(r.id,'liberada');return private.student_reservation_json(r.id);end if;
 if p_accion='ampliar' and(r.estado<>'vigente' or r.extensiones>=p_max_extensiones) then
 raise exception 'No puedes ampliar esta reserva' using errcode='IR411';end if;
 if p_accion='iniciar_pago' and r.estado='pago_en_curso' then return private.student_reservation_json(r.id);end if;
 perform 1 from public.cohorts where id=r.cohort_id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 v_now:=clock_timestamp();
 if r.expira_at<=v_now or exists(select 1 from public.student_schedule_holds where reservation_id=r.id and scheduled_at<=v_now) then perform private.close_student_reservation(r.id,'vencida');return private.student_reservation_json(r.id);end if;
 v_end:=case when p_accion='ampliar' then r.expira_at+make_interval(mins=>p_extension)
 else greatest(r.expira_at,v_now+make_interval(mins=>p_gracia)) end;
 update public.student_schedule_holds set expira_at=v_end where reservation_id=r.id and released_at is null;
 update public.student_schedule_reservations set expira_at=v_end,
 extensiones=extensiones+case when p_accion='ampliar' then 1 else 0 end,
 estado=case when p_accion='iniciar_pago' then 'pago_en_curso' else estado end,
 pago_iniciado_at=case when p_accion='iniciar_pago' then v_now else pago_iniciado_at end where id=r.id;
 update public.enrollments set reserva_expira_at=v_end where id=r.enrollment_id and etapa_inscripcion='reservado';
 insert into public.student_schedule_events(reservation_id,accion) values(r.id,case when p_accion='ampliar' then 'ampliada' else 'pago_iniciado' end);
 return private.student_reservation_json(r.id);
end $$;
create or replace function private.student_reservation_json(p_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select jsonb_build_object('id',r.id,'enrollmentId',r.enrollment_id,'estado',r.estado,
 'expiraAt',r.expira_at,'serverNow',clock_timestamp(),'extensiones',r.extensiones,
 'puedeAmpliar',r.estado='vigente' and r.extensiones<1 and r.expira_at>clock_timestamp(),
 'cohorte',jsonb_build_object('id',c.id,'nombre',c.nombre),
 'franjas',(select coalesce(jsonb_agg(jsonb_build_object('scheduledAt',h.scheduled_at)
 order by h.scheduled_at),'[]'::jsonb) from public.student_schedule_holds h where h.reservation_id=r.id))
 from public.student_schedule_reservations r join public.cohorts c on c.id=r.cohort_id where r.id=p_id
$$;
create or replace function public.delete_student_data(p_actor uuid,p_student uuid,p_version timestamptz,p_cleaned_paths text[])
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare op public.student_deletion_operations; v_role public.user_role; v_cut timestamptz;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  select rol into v_role from public.users where id=p_student for update;
  if found and v_role<>'estudiante' then raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
  select * into op from public.student_deletion_operations where student_id=p_student for update;
  if not found then raise exception 'Operación no encontrada' using errcode='CD404'; end if;
  if op.phase<>'storage' or op.updated_at is distinct from p_version then return to_jsonb(op); end if;
  if exists(select 1 from public.users where id=p_student and activo) then
    raise exception 'Primero bloquear el acceso' using errcode='CD030'; end if;
  if to_regclass('public.payments') is not null then
    raise exception 'Revisar RF-04 antes de eliminar' using errcode='0A000'; end if;
  -- FOR UPDATE del padre bloquea nuevos documentos/links por FK; después releer
  -- los documentos bajo lock incluye escrituras que ya estaban en vuelo.
  perform 1 from public.solicitudes_inscripcion where student_id=p_student order by id for update;
  perform 1 from public.solicitud_documentos where solicitud_id in
    (select id from public.solicitudes_inscripcion where student_id=p_student) order by id for update;
  if exists(select 1 from public.solicitud_documentos d join public.solicitudes_inscripcion s on s.id=d.solicitud_id
    where s.student_id=p_student and not coalesce(d.storage_path=any(p_cleaned_paths),false)) then
    raise exception 'Repetir limpieza de Storage' using errcode='CD032'; end if;
  delete from public.solicitud_documentos where solicitud_id in
    (select id from public.solicitudes_inscripcion where student_id=p_student);
  delete from public.solicitudes_inscripcion where student_id=p_student;
  delete from public.attempt_answers where attempt_id in (select id from public.exam_attempts where student_id=p_student);
  delete from public.exam_attempts where student_id=p_student;
  delete from public.practice_slot_cancellations where student_id=p_student;
  perform 1 from public.practice_slots where student_id=p_student order by id for update;
  -- RF-04: limpiar antes de las franjas/usuario; conservar guards y CAS.
  delete from public.practice_ratings where student_id=p_student;
  v_cut:=clock_timestamp();
  delete from public.practice_slots where student_id=p_student and scheduled_at<=v_cut;
  update public.practice_slots set student_id=null,status='liberado',attended=null,confirmed_at=null,
    confirmation_notified_at=null,release_notified_at=null where student_id=p_student and scheduled_at>v_cut;
  delete from public.enrollment_documents where enrollment_id in (select id from public.enrollments where student_id=p_student);
  delete from public.enrollments where student_id=p_student;
  -- Eliminar fila entera: cubre response/request_hash y request si se incorporase.
  delete from public.manual_enrollment_operations where student_id=p_student;
  delete from public.student_practice_recovery where student_id=p_student;
  delete from public.users where id=p_student;
  update public.student_deletion_operations set phase='auth',status='pendiente',data_deleted_by=p_actor,
    data_deleted_at=clock_timestamp(),updated_at=clock_timestamp() where student_id=p_student returning * into op;
  return to_jsonb(op);
end $$;
create or replace function public.begin_student_deletion(p_actor uuid,p_student uuid,p_confirmation text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare u public.users; op public.student_deletion_operations;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  select * into u from public.users where id=p_student for update;
  if found and u.rol<>'estudiante' then
    raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
  select * into op from public.student_deletion_operations where student_id=p_student for update;
  if found then
    if op.status='completo' then return to_jsonb(op); end if;
    update public.student_deletion_operations set status='pendiente',last_retry_actor_id=p_actor,
      last_retry_at=clock_timestamp(),retry_count=retry_count+1,updated_at=clock_timestamp()
      where student_id=p_student returning * into op;
  else
    if u.id is null then raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
    if p_confirmation is null or p_confirmation is distinct from u.cedula then
      raise exception 'La confirmación no coincide' using errcode='CD031'; end if;
    insert into public.student_deletion_operations(student_id,actor_id) values(p_student,p_actor) returning * into op;
  end if;
  -- Primer efecto del bloqueo, en la misma transacción que la confirmación.
  update public.users set activo=false where id=p_student;
  return to_jsonb(op);
end $$;
drop function private.payment_json(uuid),public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text),public.claim_payment_dispatch(uuid),public.record_payment_reference(uuid,text,text),public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text),public.admin_release_student_reservation(uuid,uuid),public.claim_payment_email(uuid),public.finish_payment_email(uuid,uuid,boolean);
drop table public.payment_mail_outbox,public.payment_events,public.payments;
notify pgrst,'reload schema';
commit;
