-- D: SQL para revisión; NO aplicar sin aprobación explícita y respaldo.
begin;
set local lock_timeout='5s';
do $$ begin
  if to_regclass('public.payments') is not null then
    raise exception 'Revisar RF-04 y adaptar el borrado antes de aplicar 026' using errcode='0A000';
  end if;
end $$;

create table public.student_deletion_operations (
  student_id uuid primary key,
  actor_id uuid not null,
  confirmed_at timestamptz not null default clock_timestamp(),
  phase text not null default 'bloqueo' check(phase in ('bloqueo','storage','auth','completo')),
  status text not null default 'pendiente' check(status in ('pendiente','fallido','completo')),
  last_retry_actor_id uuid,
  last_retry_at timestamptz,
  retry_count integer not null default 0 check(retry_count>=0),
  data_deleted_by uuid,
  data_deleted_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check ((status='completo')=(phase='completo')),
  check ((data_deleted_at is null)=(data_deleted_by is null)),
  check ((phase in ('auth','completo'))=(data_deleted_at is not null))
);
comment on table public.student_deletion_operations is
  'Confirmación, progreso y auditoría mínima de eliminación; sin FK, datos personales, rutas ni hashes. Completo se conserva.';
alter table public.student_deletion_operations enable row level security;
revoke all on public.student_deletion_operations from public,anon,authenticated,service_role;
grant select,insert,update on public.student_deletion_operations to service_role;

-- Un único guard compartido. Lock de users: serializa con el inicio de D.
create function private.assert_student_not_deleting(p_student uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_student for share;
  if exists(select 1 from public.student_deletion_operations where student_id=p_student and status<>'completo') then
    raise exception 'El alumno tiene una eliminación pendiente' using errcode='CD030';
  end if;
end $$;
create function private.guard_student_deletion_write()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_TABLE_NAME='users' then perform private.assert_student_not_deleting(new.id);
  else perform private.assert_student_not_deleting(new.student_id); end if;
  return new;
end $$;
create trigger users_deletion_profile_guard before update of cedula,nombre_completo,telefono,
  fecha_nacimiento,tipo_sangre,genero,ciudadania,direccion on public.users
  for each row execute function private.guard_student_deletion_write();
create trigger users_deletion_reactivation_guard before update of activo on public.users
  for each row when (new.activo) execute function private.guard_student_deletion_write();
create trigger enrollments_deletion_guard before insert on public.enrollments
  for each row execute function private.guard_student_deletion_write();
create trigger solicitudes_deletion_approval_guard before insert or update of student_id on public.solicitudes_inscripcion
  for each row when (new.student_id is not null) execute function private.guard_student_deletion_write();

create function public.begin_student_deletion(p_actor uuid,p_student uuid,p_confirmation text)
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

-- CAS por fase/versión: fallos tardíos no pisan avances ni reintentos ajenos.
create function public.advance_student_deletion(p_actor uuid,p_student uuid,p_phase text,p_version timestamptz,p_next text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare op public.student_deletion_operations;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  select * into op from public.student_deletion_operations where student_id=p_student for update;
  if not found then raise exception 'Operación no encontrada' using errcode='CD404'; end if;
  if op.status='completo' or op.phase is distinct from p_phase or op.updated_at is distinct from p_version then return to_jsonb(op); end if;
  if p_next='fallido' then
    update public.student_deletion_operations set status='fallido',updated_at=clock_timestamp()
      where student_id=p_student returning * into op;
  elsif (p_phase='bloqueo' and p_next='storage') or (p_phase='auth' and p_next='completo') then
    update public.student_deletion_operations set phase=p_next,
      status=case when p_next='completo' then 'completo' else 'pendiente' end,updated_at=clock_timestamp()
      where student_id=p_student returning * into op;
  else raise exception 'Transición inválida' using errcode='22023'; end if;
  return to_jsonb(op);
end $$;

create function public.student_deletion_storage_paths(p_actor uuid,p_student uuid)
returns setof text language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  if not exists(select 1 from public.student_deletion_operations where student_id=p_student and phase='storage') then return; end if;
  return query select distinct d.storage_path from public.solicitud_documentos d
    join public.solicitudes_inscripcion s on s.id=d.solicitud_id where s.student_id=p_student order by d.storage_path;
end $$;

create function public.delete_student_data(p_actor uuid,p_student uuid,p_version timestamptz,p_cleaned_paths text[])
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

revoke all on function public.begin_student_deletion(uuid,uuid,text),
  public.advance_student_deletion(uuid,uuid,text,timestamptz,text),
  public.student_deletion_storage_paths(uuid,uuid),public.delete_student_data(uuid,uuid,timestamptz,text[])
  from public,anon,authenticated;
grant execute on function public.begin_student_deletion(uuid,uuid,text),
  public.advance_student_deletion(uuid,uuid,text,timestamptz,text),
  public.student_deletion_storage_paths(uuid,uuid),public.delete_student_data(uuid,uuid,timestamptz,text[]) to service_role;
revoke all on function private.assert_student_not_deleting(uuid),private.guard_student_deletion_write() from public,anon,authenticated;
grant execute on function private.assert_student_not_deleting(uuid),private.guard_student_deletion_write() to service_role;
notify pgrst,'reload schema';
commit;
