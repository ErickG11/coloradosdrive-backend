-- Rollback manual de 033. No descartar una bandeja que ya tenga datos.
begin;
set local lock_timeout = '5s';
lock table public.notifications in access exclusive mode;
do $$ begin
  if exists(select 1 from public.notifications) then
    raise exception 'No se puede revertir 033: existen notificaciones persistidas; preparar correccion de avance';
  end if;
end $$;

create or replace function public.cancel_practice_slot_with_reason(
  p_slot_id uuid, p_student_id uuid, p_motivo_categoria text, p_motivo_texto text
) returns jsonb language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare s public.practice_slots; e public.enrollments; v_now timestamptz;
  v_free boolean; v_result text; v_number smallint; v_id uuid; v_broadcast boolean;
begin
  if p_motivo_categoria is null or p_motivo_categoria not in
      ('salud', 'trabajo', 'estudios', 'familiar', 'transporte', 'otro')
    or p_motivo_texto is null or char_length(btrim(p_motivo_texto)) < 10 then
    raise exception 'Indica una categoría válida y un motivo de al menos 10 caracteres'
      using errcode = '22023'; end if;
  -- Mismo orden que acceso/eliminación: alumno, matrícula y después franja.
  -- FOR SHARE conserva activo mientras se cancela; permite concurrencia de dos cancelaciones.
  perform 1 from public.users where id = p_student_id and rol = 'estudiante' and activo for share;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  perform private.assert_student_not_deleting(p_student_id);
  select * into s from public.practice_slots where id = p_slot_id and student_id = p_student_id;
  if not found then raise exception 'Franja no encontrada' using errcode = 'CD404'; end if;
  select * into e from public.enrollments where student_id = p_student_id
    and cohort_id = s.cohort_id and status = 'activo' for update;
  if not found then raise exception 'No hay matrícula activa para esta práctica' using errcode = 'CD409'; end if;
  select * into s from public.practice_slots where id = p_slot_id and student_id = p_student_id for update;
  if not found then raise exception 'Franja no encontrada' using errcode = 'CD404'; end if;
  -- El reloj se consulta después de esperar todos los bloqueos.
  v_now := clock_timestamp();
  if s.status not in ('asignado', 'confirmado') or s.scheduled_at <= v_now then
    raise exception 'Solo se puede cancelar una práctica antes de su inicio' using errcode = 'CD409'; end if;
  if s.cohort_id is distinct from e.cohort_id then
    raise exception 'La práctica cambió; vuelve a consultar' using errcode = 'CD409'; end if;
  select exists(select 1 from private.eligible_free_slots_for_enrollment(e.id, s.id)) into v_free;
  v_now := clock_timestamp();
  if s.scheduled_at <= v_now then
    raise exception 'Solo se puede cancelar una práctica antes de su inicio' using errcode = 'CD409'; end if;
  if e.reprogramaciones_usadas >= 2 then v_result := 'falta';
  elsif v_free then
    v_result := 'reprogramable';
    update public.enrollments set reprogramaciones_usadas = reprogramaciones_usadas + 1
      where id = e.id returning reprogramaciones_usadas into v_number;
  else v_result := 'hora_perdida';
  end if;
  v_broadcast := public.practice_slot_window_open(s.scheduled_at, v_now);
  insert into public.practice_slot_cancellations(slot_id, enrollment_id, student_id, instructor_id,
    cohort_id, slot_starts_at, cancelled_at, motivo_categoria, motivo_texto, resultado,
    consumio_reprogramacion, reprogramacion_numero)
    values(s.id, e.id, p_student_id, s.instructor_id, s.cohort_id, s.scheduled_at, v_now,
      p_motivo_categoria, btrim(p_motivo_texto), v_result, v_result = 'reprogramable', v_number)
    returning id into v_id;
  update public.practice_slots set student_id = null,
    status = case when v_broadcast then 'liberado'::public.practice_slot_status else 'sin_practica'::public.practice_slot_status end,
    confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
    where id = s.id returning * into s;
  return jsonb_build_object('slot', to_jsonb(s), 'cancellationId', v_id, 'enrollmentId', e.id,
    'studentId', p_student_id, 'instructorId', s.instructor_id, 'cohortId', s.cohort_id,
    'cancelledAt', v_now, 'resultado', v_result, 'consumioReprogramacion', v_number is not null,
    'reprogramacionNumero', v_number, 'reprogramacionesRestantes', 2 - coalesce(v_number, e.reprogramaciones_usadas),
    'difundirCohorte', v_broadcast);
end;
$$;

create or replace function public.swap_practice_slot(p_slot_id uuid, p_student_id uuid, p_source_slot_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare target public.practice_slots; source public.practice_slots; e public.enrollments;
  b record; candidate record; v_cancel uuid; v_now timestamptz; v_number smallint;
begin
  -- Orden común con E1/eliminación: alumno -> matrícula -> franjas por UUID.
  -- UPDATE del alumno serializa también cambios en otras matrículas del mismo alumno.
  perform 1 from public.users where id = p_student_id and rol = 'estudiante' and activo for update;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  perform private.assert_student_not_deleting(p_student_id);
  select * into target from public.practice_slots where id = p_slot_id;
  if not found then raise exception 'Cupo no encontrado' using errcode = 'CD404'; end if;
  select * into e from public.enrollments where student_id = p_student_id
    and cohort_id = target.cohort_id and status = 'activo' for update;
  if not found then raise exception 'No tienes matrícula activa en la cohorte de este cupo' using errcode = 'CD403'; end if;
  if p_source_slot_id is not null and not exists(select 1 from private.pending_practice_slots(e.id) where id = p_source_slot_id) then
    raise exception 'La práctica a soltar no es una práctica futura propia de esta matrícula' using errcode = 'CD409'; end if;
  perform 1 from public.practice_slots where id = p_slot_id or id = p_source_slot_id order by id for update;
  select * into target from public.practice_slots where id = p_slot_id;
  if not found or target.status not in ('disponible', 'liberado') or target.student_id is not null then
    raise exception 'Otro alumno tomó este cupo o ya no está disponible' using errcode = 'CD409'; end if;
  if target.cohort_id is distinct from e.cohort_id then
    raise exception 'El cupo cambió; vuelve a consultar' using errcode = 'CD409'; end if;
  -- Conserva activo al instructor hasta el commit; el helper E1 también lo valida.
  if exists(select 1 from public.practice_slot_cancellations c
      where c.student_id = p_student_id and c.slot_id = target.id) then
    raise exception 'No puedes volver a tomar una práctica que tú mismo soltaste' using errcode = 'CD409'; end if;
  perform 1 from public.users where id = target.instructor_id and rol = 'instructor' and activo for share;
  if not found then raise exception 'El instructor está inactivo' using errcode = 'CD023'; end if;
  select * into b from private.practice_replacement_balance(e.id);
  if b.reposiciones_pendientes > 0 and p_source_slot_id is not null then
    raise exception 'Tienes una hora pendiente por reponer: no debes soltar otra práctica' using errcode = '22023';
  elsif b.reposiciones_pendientes = 0 then
    if e.reprogramaciones_usadas >= 2 then
      raise exception 'Ya usaste tus 2 reprogramaciones; no puedes cambiar otra práctica' using errcode = 'CD409'; end if;
    if p_source_slot_id is null then
      raise exception 'Debes elegir la práctica pendiente que vas a soltar' using errcode = '22023'; end if;
  end if;
  select * into candidate from private.eligible_practice_slot_changes(e.id) c where (c.slot).id = p_slot_id;
  if not found or (candidate.caso = 'B' and not p_source_slot_id = any(candidate.source_slot_ids)) then
    raise exception 'Este cupo no es elegible: revisa horario, modalidad, fecha fin y horas del día' using errcode = 'CD409'; end if;
  v_now := clock_timestamp();
  if not public.practice_slot_window_open(target.scheduled_at, v_now) then
    raise exception 'Faltan 5 minutos o menos: el cupo ya cerró' using errcode = 'CD409'; end if;
  if candidate.caso = 'B' then
    select * into source from private.pending_practice_slots(e.id) where id = p_source_slot_id;
    if not found then raise exception 'La práctica que ibas a soltar ya empezó o cambió' using errcode = 'CD409'; end if;
    update public.enrollments set reprogramaciones_usadas = reprogramaciones_usadas + 1
      where id = e.id returning reprogramaciones_usadas into v_number;
    insert into public.practice_slot_cancellations(slot_id, enrollment_id, student_id, instructor_id,
      cohort_id, slot_starts_at, cancelled_at, motivo_categoria, motivo_texto, resultado,
      consumio_reprogramacion, reprogramacion_numero, origen, repuesto_por_slot_id, repuesto_en)
      values(source.id, e.id, p_student_id, source.instructor_id, source.cohort_id, source.scheduled_at,
        v_now, 'otro', 'Cambio de práctica por cupo disponible', 'reprogramable', true, v_number,
        'cambio_cupo', target.id, v_now) returning id into v_cancel;
    -- Primero libera el origen: evita la exclusión GiST si se superponen origen y destino.
    update public.practice_slots set student_id = null, status = 'liberado', attended = null,
      confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
      where id = source.id and student_id = p_student_id and status in ('asignado', 'confirmado')
        and scheduled_at > clock_timestamp();
    if not found then raise exception 'La práctica que ibas a soltar ya empezó o cambió' using errcode = 'CD409'; end if;
  else
    select c.id into v_cancel from public.practice_slot_cancellations c
      where c.enrollment_id = e.id and c.resultado = 'reprogramable' and c.origen = 'alumno' and c.repuesto_en is null
      order by c.cancelled_at, c.id limit 1 for update;
    if not found then raise exception 'La reposición ya fue utilizada; vuelve a consultar' using errcode = 'CD409'; end if;
    update public.practice_slot_cancellations set repuesto_por_slot_id = target.id, repuesto_en = v_now where id = v_cancel;
  end if;
  update public.practice_slots set student_id = p_student_id, status = 'asignado', attended = null,
    confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
    where id = target.id and student_id is null and status in ('disponible', 'liberado')
      and public.practice_slot_window_open(scheduled_at, clock_timestamp()) returning * into target;
  if not found then
    -- También revierte contador/historial/origen si se cruzó T-5 DURANTE la escritura.
    raise exception 'Faltan 5 minutos o menos: el cupo ya cerró' using errcode = 'CD409'; end if;
  return jsonb_build_object('slot', to_jsonb(target), 'caso', candidate.caso,
    'practicaSoltadaId', p_source_slot_id, 'cancellationId', v_cancel, 'enrollmentId', e.id,
    'reprogramacionesRestantes', 2 - coalesce(v_number, e.reprogramaciones_usadas));
end;
$$;

create or replace function public.practice_slot_transition_due(
  p_slot public.practice_slots, p_transition text, p_now timestamptz
) returns boolean language sql stable security invoker set search_path = '' as $$
  select case p_transition
    when 'remind' then (p_slot).status = 'asignado' and (p_slot).confirmation_notified_at is null
      and p_now >= (p_slot).scheduled_at - interval '20 minutes'
      and public.practice_slot_window_open((p_slot).scheduled_at, p_now)
    when 'close' then (p_slot).status = 'liberado'
      and not public.practice_slot_window_open((p_slot).scheduled_at, p_now)
    when 'complete' then (p_slot).status in ('asignado', 'confirmado')
      and p_now >= (p_slot).scheduled_at + interval '60 minutes'
    else false end;
$$;

create or replace function public.transition_practice_slot_for_scheduler(
  p_slot_id uuid, p_transition text, p_expected_version text
) returns setof public.practice_slots language plpgsql volatile security invoker set search_path = '' as $$
declare current_slot public.practice_slots; current_version text;
begin
  select s.* into current_slot from public.practice_slots s where s.id = p_slot_id for update;
  if not found then return; end if;
  select s.xmin::text into current_version from public.practice_slots s where s.id = p_slot_id;
  if current_version is distinct from p_expected_version then return; end if;
  if p_transition = 'remind' then
    return query update public.practice_slots s set confirmation_notified_at = clock_timestamp()
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status = 'asignado' and s.student_id = current_slot.student_id
      and s.confirmation_notified_at is null
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  elsif p_transition = 'close' then
    return query update public.practice_slots s set status = 'sin_practica', student_id = null,
      confirmed_at = null, confirmation_notified_at = null
    where s.id = p_slot_id and s.xmin::text = p_expected_version and s.status = 'liberado'
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  elsif p_transition = 'complete' then
    return query update public.practice_slots s set status = 'completado'
    where s.id = p_slot_id and s.xmin::text = p_expected_version
      and s.status in ('asignado', 'confirmado') and s.student_id = current_slot.student_id
      and public.practice_slot_transition_due(s, p_transition, clock_timestamp()) returning s.*;
  end if;
end;
$$;

drop function public.finish_notification_email(uuid,uuid,text);
drop function public.claim_notification_email();
drop function public.read_all_user_notifications(uuid);
drop function public.mark_user_notification_read(uuid,uuid);
drop function public.list_user_notifications(uuid,integer,integer);
drop function private.assert_notification_owner(uuid);
drop function private.notify_eligible_released_slot(public.practice_slots);
drop function private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean);
drop table public.notifications;
notify pgrst, 'reload schema';
commit;
