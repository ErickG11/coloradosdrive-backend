-- RF-03 E1. 028 y 029 ya existen: se conserva su numeración e historial.
-- Aplicación manual tras asistencia-a-preflight.sql. No ejecutar desde la app.
begin;
set local lock_timeout = '5s';

alter table public.enrollments
  add column reprogramaciones_usadas smallint not null default 0
  constraint enrollments_reprogramaciones_usadas_check check (reprogramaciones_usadas between 0 and 2);

create table public.practice_slot_cancellations (
  id uuid primary key default gen_random_uuid(),
  -- IDs de instantánea: una franja se reutiliza y puede desaparecer después.
  -- La eliminación definitiva del alumno borra explícitamente este historial.
  slot_id uuid not null,
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  student_id uuid not null,
  instructor_id uuid not null,
  cohort_id uuid not null,
  slot_starts_at timestamptz not null,
  cancelled_at timestamptz not null,
  motivo_categoria text not null check (motivo_categoria in
    ('salud', 'trabajo', 'estudios', 'familiar', 'transporte', 'otro')),
  motivo_texto text not null check (char_length(btrim(motivo_texto)) >= 10),
  resultado text not null check (resultado in ('reprogramable', 'hora_perdida', 'falta')),
  consumio_reprogramacion boolean not null,
  reprogramacion_numero smallint,
  constraint practice_slot_cancellations_counter_consistency check (
    (resultado = 'reprogramable' and consumio_reprogramacion
      and reprogramacion_numero is not null and reprogramacion_numero between 1 and 2)
    or (resultado in ('hora_perdida', 'falta') and not consumio_reprogramacion
      and reprogramacion_numero is null)
  )
);
create index practice_slot_cancellations_student_idx on public.practice_slot_cancellations(student_id);
create unique index practice_slot_cancellations_enrollment_number_idx
  on public.practice_slot_cancellations(enrollment_id, reprogramacion_numero)
  where reprogramacion_numero is not null;
alter table public.practice_slot_cancellations enable row level security;
revoke all on public.practice_slot_cancellations from public, anon, authenticated, service_role;
grant select, insert, delete on public.practice_slot_cancellations to service_role;

-- Sin escritura ni reservas: E2 debe volver a validar bajo sus propios locks.
-- p_excluded_slot_id permite evaluar el hueco que dejará una cancelación.
create function private.eligible_free_slots_for_enrollment(
  p_enrollment_id uuid, p_excluded_slot_id uuid default null
) returns setof public.practice_slots
language plpgsql stable security invoker set search_path = '' as $$
declare e public.enrollments; v_end date; v_end_text text; v_mode text; v_now timestamptz := clock_timestamp();
begin
  select * into e from public.enrollments where id = p_enrollment_id;
  if not found then raise exception 'Matrícula no encontrada' using errcode = 'CD404'; end if;
  v_end_text := e.practice_plan->>'fechaFinElegida';
  v_mode := e.practice_plan->>'modalidad';
  if v_end_text is null or v_end_text !~ '^\d{4}-\d{2}-\d{2}$'
    or v_mode is null or v_mode not in ('entre_semana', 'fin_de_semana') then
    raise exception 'La matrícula no tiene fecha fin o modalidad de prácticas válida; requiere revisión'
      using errcode = 'CD409';
  end if;
  begin
    v_end := v_end_text::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'La fecha fin de prácticas de la matrícula es inválida; requiere revisión'
      using errcode = 'CD409';
  end;
  return query
    select s.* from public.practice_slots s
    join public.users instructor on instructor.id = s.instructor_id and instructor.activo
    join public.users student on student.id = e.student_id and student.activo
    where e.status = 'activo' and s.cohort_id = e.cohort_id
      and s.id is distinct from p_excluded_slot_id
      and s.status in ('disponible', 'liberado') and s.student_id is null
      and s.duration_minutes = 60
      and s.scheduled_at > v_now
      -- Coincide con el límite vigente de reclamación: no ofrecer alternativas cerradas a T-5.
      and public.practice_slot_window_open(s.scheduled_at, v_now)
      and (s.scheduled_at at time zone 'America/Guayaquil')::date <= v_end
      and ((v_mode = 'entre_semana' and extract(isodow from s.scheduled_at at time zone 'America/Guayaquil') between 1 and 5)
        or (v_mode = 'fin_de_semana' and extract(isodow from s.scheduled_at at time zone 'America/Guayaquil') in (6, 7)))
      and not exists (
        select 1 from public.practice_slots own
        where own.student_id = e.student_id and own.id is distinct from p_excluded_slot_id
          and own.status in ('asignado', 'confirmado', 'completado')
          and tsrange(own.scheduled_at at time zone 'UTC',
            (own.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
          && tsrange(s.scheduled_at at time zone 'UTC',
            (s.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
      )
    order by s.scheduled_at, s.id;
end;
$$;

create function public.preview_practice_slot_cancellation(p_slot_id uuid, p_student_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare s public.practice_slots; e public.enrollments; v_free boolean;
begin
  if not exists(select 1 from public.users where id = p_student_id and rol = 'estudiante' and activo) then
    raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  select * into s from public.practice_slots where id = p_slot_id and student_id = p_student_id;
  if not found then raise exception 'Franja no encontrada' using errcode = 'CD404'; end if;
  if s.status not in ('asignado', 'confirmado') or s.scheduled_at <= statement_timestamp() then
    raise exception 'Solo se puede cancelar una práctica antes de su inicio' using errcode = 'CD409'; end if;
  select * into e from public.enrollments where student_id = p_student_id
    and cohort_id = s.cohort_id and status = 'activo';
  if not found then raise exception 'No hay matrícula activa para esta práctica' using errcode = 'CD409'; end if;
  select exists(select 1 from private.eligible_free_slots_for_enrollment(e.id, s.id)) into v_free;
  return jsonb_build_object('reprogramacionesRestantes', 2 - e.reprogramaciones_usadas,
    'hayFranjasLibres', v_free, 'resultadoSiCancela',
    case when e.reprogramaciones_usadas >= 2 then 'falta'
      when v_free then 'reprogramable' else 'hora_perdida' end);
end;
$$;

create function public.cancel_practice_slot_with_reason(
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

-- Cerrar la vía antigua sin motivo, incluso para consumidores internos.
-- La lógica privada existente se conserva para claim/confirm y recuperación administrativa.
create or replace function public.act_on_practice_slot(p_slot_id uuid, p_student_id uuid, p_action text)
returns setof public.practice_slots language plpgsql security invoker set search_path = '' as $$
begin
  if p_action is null or p_action not in ('claim', 'confirm') then
    raise exception 'La cancelación requiere motivo; utiliza cancel_practice_slot_with_reason' using errcode = '22023'; end if;
  perform 1 from public.users where id = p_student_id and rol = 'estudiante' and activo for share;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  -- Reclamar sigue el orden matrícula -> franja usado por la nueva cancelación.
  if p_action = 'claim' then
    perform 1 from public.enrollments e join public.practice_slots s on s.cohort_id = e.cohort_id
      where s.id = p_slot_id and e.student_id = p_student_id and e.status = 'activo' for share of e;
  end if;
  return query select * from private.book_practice_slot(p_slot_id, p_student_id, p_action);
end;
$$;

-- Confirmación opcional: asignado no se cierra por silencio y termina igual que confirmado.
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

revoke all on function private.eligible_free_slots_for_enrollment(uuid, uuid),
  public.preview_practice_slot_cancellation(uuid, uuid),
  public.cancel_practice_slot_with_reason(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function private.eligible_free_slots_for_enrollment(uuid, uuid),
  public.preview_practice_slot_cancellation(uuid, uuid),
  public.cancel_practice_slot_with_reason(uuid, uuid, text, text) to service_role;

-- Impedir el bypass también en el helper privado heredado.
create or replace function private.book_practice_slot(p_slot_id uuid, p_student_id uuid, p_action text)
returns setof public.practice_slots
language plpgsql volatile security invoker set search_path = '' as $$
declare current_slot public.practice_slots; changed_slot public.practice_slots;
begin
  if p_action is null or p_action not in ('claim', 'confirm') then
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
  end if;
  return next changed_slot;
end;
$$;

-- Mantener guards y auditoría de 026; borrar historial antes de las matrículas.
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


notify pgrst, 'reload schema';
commit;
