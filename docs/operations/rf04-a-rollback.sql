-- SQL Editor. Retirada completa solo antes de usar RF-04; nunca descartar respuestas.
begin;
set local lock_timeout = '5s';
lock table public.practice_slots in share row exclusive mode;
lock table public.practice_ratings in access exclusive mode;
do $$ begin
 if exists(select 1 from public.practice_ratings) or exists(select 1 from public.notifications where tipo='encuesta_practica')
 or exists(select 1 from public.practice_slots where rating_window_opens_at is not null) then
 raise exception 'No se puede revertir 035: existen datos RF-04; preparar correccion de avance'; end if;
end $$;
create or replace function private.write_practice_attendance(
  p_slot uuid, p_actor uuid, p_attended boolean, p_correction boolean, p_motivo text default null
) returns setof public.practice_slots
language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare s public.practice_slots; v_student uuid; v_role text; v_now timestamptz; v_event uuid;
begin
  select student_id into v_student from public.practice_slots where id = p_slot;
  if v_student is not null then
    perform 1 from public.users where id = v_student for share;
    perform private.assert_student_not_deleting(v_student);
  end if;
  select rol::text into v_role from public.users where id = p_actor and activo for share;
  if v_role is null or v_role not in ('instructor', 'admin') or (not p_correction and v_role <> 'instructor') then
    raise exception 'Tu cuenta no tiene permiso para esta operación de asistencia' using errcode = 'AT403'; end if;
  select * into s from public.practice_slots where id = p_slot for update;
  if not found or (v_role = 'instructor' and s.instructor_id <> p_actor) then
    raise exception 'Franja no encontrada' using errcode = 'AT404'; end if;
  if s.student_id is distinct from v_student then
    raise exception 'La práctica cambió; vuelve a consultar' using errcode = 'CD409'; end if;
  v_now := clock_timestamp();
  if s.status <> 'completado' or s.scheduled_at + make_interval(mins => s.duration_minutes) > v_now then
    raise exception 'Solo se puede registrar asistencia de una práctica completada' using errcode = 'AT413'; end if;
  if p_attended is null then raise exception 'Indica si el alumno asistió' using errcode = '22023'; end if;
  if p_correction then
    if p_motivo is null or char_length(private.trim_attendance_reason(p_motivo)) not between 10 and 500 then
      raise exception 'El motivo debe tener entre 10 y 500 caracteres' using errcode = 'AT412'; end if;
    if v_role = 'instructor' and not private.attendance_correction_window_open(s.scheduled_at, s.duration_minutes, v_now) then
      raise exception 'Pasaron las 48 horas para corregir; solicita la corrección al administrador' using errcode = 'AT410'; end if;
    if v_role = 'instructor' and s.attended is null then
      raise exception 'La asistencia aún no está registrada; realiza primero el registro inicial' using errcode = 'AT415'; end if;
    if s.attended is not distinct from p_attended then
      raise exception 'La corrección debe cambiar el valor de asistencia' using errcode = 'AT411'; end if;
  elsif s.attended is not null then
    raise exception 'La asistencia ya fue registrada; para corregirla indica un motivo' using errcode = 'AT414';
  end if;
  insert into public.practice_attendance_events(slot_id, student_id, instructor_id, cohort_id,
    scheduled_at, duration_minutes, actor_id, actor_role, created_at, tipo, previous_attended, new_attended, motivo)
  values(s.id, s.student_id, s.instructor_id, s.cohort_id, s.scheduled_at, s.duration_minutes,
    p_actor, v_role, v_now, case when p_correction then 'correccion' else 'registro' end,
    s.attended, p_attended, case when p_correction then private.trim_attendance_reason(p_motivo) else null end) returning id into v_event;
  update public.practice_slots set attended = p_attended where id = s.id returning * into s;
  if p_correction then perform private.enqueue_attendance_correction(v_event); end if;
  return next s;
end;
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
drop function public.submit_practice_rating(uuid,uuid,numeric,text);
drop function public.list_student_pending_practice_ratings(uuid,integer,integer);
drop function public.list_admin_instructor_ratings(uuid,integer,integer);
drop function public.admin_instructor_rating_detail(uuid,uuid,integer,integer);
drop trigger practice_ratings_guard on public.practice_ratings;
drop trigger practice_ratings_deletion_guard on public.practice_ratings;
drop trigger practice_slots_rating_window_guard on public.practice_slots;
drop function private.guard_practice_rating();
drop function private.guard_practice_rating_window();
drop function private.lock_rateable_practice(uuid,uuid);
drop table public.practice_ratings;
drop index public.practice_slots_rating_pending_idx;
alter table public.practice_slots drop constraint practice_slots_rating_window_check;
alter table public.practice_slots drop column rating_window_opens_at;
alter table public.notifications drop constraint notifications_rating_inbox_check;
alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check check (tipo in (
 'recordatorio_practica','resultado_cancelacion','cupo_disponible','sin_practica_instructor','cambio_realizado','asistencia_corregida'));
drop table private.practice_rating_rollout;
notify pgrst, 'reload schema';
commit;
