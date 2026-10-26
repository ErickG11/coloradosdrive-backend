-- Reversión manual de 030, después de volver al backend anterior.
-- BLOQUEADA si hay historial/contadores: exportar y resolver con el responsable antes.
-- No borra historial ni revierte cancelaciones ya confirmadas.
begin;
set local lock_timeout = '5s';
lock table public.enrollments, public.practice_slots, public.practice_slot_cancellations in access exclusive mode;
do $$ begin
  if exists(select 1 from public.practice_slot_cancellations)
    or exists(select 1 from public.enrollments where reprogramaciones_usadas <> 0) then
    raise exception 'Reversión bloqueada: existen cancelaciones o contadores; conservar y revisar los datos';
  end if;
end $$;
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
  perform 1 from public.practice_slots where student_id=p_student order by id for update;
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

create or replace function public.act_on_practice_slot(p_slot_id uuid,p_student_id uuid,p_action text)
returns setof public.practice_slots language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_student_id and rol='estudiante' and activo for share;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode='CD403'; end if;
  return query select * from private.book_practice_slot(p_slot_id,p_student_id,p_action);
end;
$$;

create or replace function private.book_practice_slot(p_slot_id uuid, p_student_id uuid, p_action text)
returns setof public.practice_slots
language plpgsql volatile security invoker set search_path = '' as $$
declare current_slot public.practice_slots; changed_slot public.practice_slots;
begin
  if p_action is null or p_action not in ('claim', 'confirm', 'cancel') then
    raise exception using errcode = '22023', message = 'Acción de práctica inválida';
  end if;
  select s.* into current_slot from public.practice_slots s where s.id = p_slot_id for update;
  if not found then
    raise exception using errcode = 'CD404', message = 'Franja no encontrada';
  end if;

  if p_action = 'claim' then
    perform 1 from public.enrollments e where e.student_id = p_student_id
      and e.cohort_id = current_slot.cohort_id and e.status = 'activo' for share;
    if not found then
      raise exception using errcode = 'CD403',
        message = 'No tienes una inscripción activa en la cohorte de esta franja';
    end if;
    if current_slot.status not in ('disponible', 'liberado') then
      raise exception using errcode = 'CD409', message = 'Esta franja ya no está disponible';
    end if;
    perform 1 from public.users u where u.id = current_slot.instructor_id and u.activo for share;
    if not found then
      raise exception using errcode = 'CD023', message = 'El instructor está inactivo';
    end if;
    update public.practice_slots s set student_id = p_student_id, status = 'asignado',
      confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
    where s.id = p_slot_id and s.status in ('disponible', 'liberado')
      and s.cohort_id = current_slot.cohort_id
      and public.practice_slot_window_open(s.scheduled_at, clock_timestamp())
    returning s.* into changed_slot;
    if not found then
      raise exception using errcode = 'CD409', message = 'La ventana de reclamación ya cerró';
    end if;
  else
    if current_slot.student_id is distinct from p_student_id then
      raise exception using errcode = 'CD404', message = 'Franja no encontrada';
    end if;
    if p_action = 'confirm' then
      if current_slot.status <> 'asignado' then
        raise exception using errcode = 'CD409', message = 'Este turno no está pendiente de confirmación';
      end if;
      update public.practice_slots s set status = 'confirmado', confirmed_at = clock_timestamp()
      where s.id = p_slot_id and s.student_id = p_student_id and s.status = 'asignado'
        and public.practice_slot_window_open(s.scheduled_at, clock_timestamp())
      returning s.* into changed_slot;
      if not found then
        raise exception using errcode = 'CD409', message = 'La ventana de confirmación ya cerró';
      end if;
    else
      if current_slot.status not in ('asignado', 'confirmado') then
        raise exception using errcode = 'CD409', message = 'Este turno no se puede cancelar';
      end if;
      update public.practice_slots s set student_id = null, status = 'liberado',
        confirmed_at = null, confirmation_notified_at = null, release_notified_at = clock_timestamp()
      where s.id = p_slot_id and s.student_id = p_student_id and s.status in ('asignado', 'confirmado')
      returning s.* into changed_slot;
      if not found then
        raise exception using errcode = 'CD409', message = 'Este turno no se puede cancelar';
      end if;
    end if;
  end if;
  return next changed_slot;
end;
$$;
create or replace function public.practice_slot_transition_due(
  p_slot public.practice_slots, p_transition text, p_now timestamptz
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case p_transition
    when 'remind' then (p_slot).status = 'asignado' and (p_slot).confirmation_notified_at is null
      and p_now >= (p_slot).scheduled_at - interval '20 minutes'
      and public.practice_slot_window_open((p_slot).scheduled_at, p_now)
    when 'close' then (p_slot).status in ('disponible', 'asignado', 'liberado')
      and not public.practice_slot_window_open((p_slot).scheduled_at, p_now)
    when 'complete' then (p_slot).status = 'confirmado'
      and p_now >= (p_slot).scheduled_at + interval '60 minutes'
    else false
  end;
$$;

create or replace function public.transition_practice_slot_for_scheduler(
  p_slot_id uuid, p_transition text, p_expected_version text
)
returns setof public.practice_slots
language plpgsql volatile security invoker set search_path = '' as $$
declare current_slot public.practice_slots; current_version text;
begin
  select s.* into current_slot
    from public.practice_slots s where s.id = p_slot_id for update;
  if not found then return; end if;
  select s.xmin::text into current_version from public.practice_slots s where s.id = p_slot_id;
  if current_version is distinct from p_expected_version then return; end if;
  -- Repetir versión, estado y tiempo EN la escritura, después de adquirir el lock.
  -- Si perdió la carrera devuelve cero filas: no hay efectos secundarios.
  if p_transition = 'remind' then
    return query update public.practice_slots s set confirmation_notified_at = clock_timestamp()
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status = 'asignado' and s.student_id = current_slot.student_id
      and s.confirmation_notified_at is null
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  elsif p_transition = 'close' then
    return query update public.practice_slots s set status = 'sin_practica', student_id = null,
      confirmed_at = null, confirmation_notified_at = null
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status = current_slot.status and s.student_id is not distinct from current_slot.student_id
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  elsif p_transition = 'complete' then
    return query update public.practice_slots s set status = 'completado'
    where s.id = p_slot_id and s.xmin::text = p_expected_version and s.status = 'confirmado'
      and s.student_id = current_slot.student_id
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  end if;
end;
$$;


drop function public.cancel_practice_slot_with_reason(uuid, uuid, text, text);
drop function public.preview_practice_slot_cancellation(uuid, uuid);
drop function private.eligible_free_slots_for_enrollment(uuid, uuid);
drop table public.practice_slot_cancellations;
alter table public.enrollments drop column reprogramaciones_usadas;
notify pgrst, 'reload schema';
commit;
