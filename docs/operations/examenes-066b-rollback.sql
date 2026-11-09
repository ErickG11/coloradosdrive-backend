-- Manual: detener backend F1. Primero rollback 066b, luego rollback 066a.
begin;
set local lock_timeout='5s';
do $guard_rollback_066b$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure) is distinct from 'd8ce262575d1e5b76d78d7d01441c909' then raise exception 'Rollback066b: cuerpo distinto; no sobrescribir cambios posteriores';end if;
end $guard_rollback_066b$;
create or replace function public.delete_student_data(p_actor uuid,p_student uuid,p_version timestamptz,p_cleaned_paths text[])
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $restore_student_deletion$
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
  if exists(select 1 from public.payments where student_id=p_student and estado in ('pendiente','aprobado','revision')) then
    raise exception 'Resolver y conservar el historial de pagos antes de eliminar' using errcode='IP423'; end if;
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
end $restore_student_deletion$;
do $close_content_api$ declare signature text; f regprocedure;begin
 foreach signature in array array['private.content_admin(uuid,text,jsonb)',
  'private.content_student(uuid,text,jsonb)',
  'private.finish_content_attempt(uuid,uuid,jsonb)',
  'private.content_attempt_state(uuid,uuid)',
  'public.content_attempt_state(uuid,uuid)',
  'public.content_admin(uuid,text,jsonb)',
  'public.content_student(uuid,text,jsonb)',
  'public.content_start_attempt(uuid,uuid)',
  'public.content_finish_attempt(uuid,uuid,jsonb)',
  'public.content_exam_access(uuid,uuid)'] loop
  f:=to_regprocedure(signature);
  if f is null then raise exception '066a: missing function %',signature;end if;
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $close_content_api$;
notify pgrst,'reload schema';
commit;
select '066b revertida; funciones cerradas, continuar rollback 066a' as estado;
