-- Revertir primero 041 y el backend. Respaldar enviada_at: el rollback elimina ese dato.
begin;
drop view if exists public.solicitudes_admin;
drop function if exists public.enviar_solicitud(uuid,text);
drop function if exists public.resumen_solicitudes();
drop function if exists public.correo_tiene_cuenta(text);
create or replace function public.finalizar_aprobacion_solicitud(p_solicitud uuid, p_actor uuid, p_claim timestamptz, p_student uuid, p_enrollment uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;
begin
 select * into s from public.solicitudes_inscripcion where id=p_solicitud
   and estado='pendiente_revision' and reviewed_by=p_actor and reviewed_at=p_claim for update;
 if not found then raise exception 'La solicitud está cerrada o en resolución' using errcode='SI409'; end if;
 if not exists(select 1 from public.solicitud_consentimientos where solicitud_id=s.id
   and acepto_tratamiento and declara_veracidad) then
   raise exception 'Consentimiento ausente' using errcode='SI403'; end if;
 if not exists(select 1 from public.enrollments where id=p_enrollment and student_id=p_student and course_id=s.course_id) then
   raise exception 'Matrícula no corresponde a solicitud' using errcode='SI409'; end if;
 insert into public.enrollment_documents(enrollment_id,tipo,estado)
 select p_enrollment,tipo,case when tipo='papeleta_votacion'
   and date_part('year',age((now() at time zone 'America/Guayaquil')::date,s.fecha_nacimiento))>=65 then 'no_aplica' else 'pendiente' end
 from unnest(array['cedula','papeleta_votacion','tipo_sangre','titulo_bachiller']) tipo;
 update public.solicitudes_inscripcion set estado='aprobada',student_id=p_student,motivo_rechazo=null where id=s.id;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(s.id,p_actor,'solicitud_aprobada');
end $$;
revoke all on function public.finalizar_aprobacion_solicitud(uuid,uuid,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalizar_aprobacion_solicitud(uuid,uuid,timestamptz,uuid,uuid) to service_role;
-- Serializa archivos/consentimientos frente a una decisión en curso.
create or replace function public.guard_solicitud_edit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;
begin
 select * into s from public.solicitudes_inscripcion where id=new.solicitud_id for update;
 if not found or s.estado='aprobada' or (s.estado='pendiente_revision' and s.reviewed_at is not null)
 or (tg_table_name='solicitud_documentos' and s.estado<>'pendiente_revision') then
   raise exception 'La solicitud está cerrada o en resolución' using errcode='SI409'; end if;
 return new;
end $$;
drop trigger if exists solicitud_documentos_edit_guard on public.solicitud_documentos;
create trigger solicitud_documentos_edit_guard before insert or update on public.solicitud_documentos for each row execute function public.guard_solicitud_edit();
drop trigger if exists solicitud_consentimientos_edit_guard on public.solicitud_consentimientos;
create trigger solicitud_consentimientos_edit_guard before insert or update on public.solicitud_consentimientos for each row execute function public.guard_solicitud_edit();
revoke all on function public.guard_solicitud_edit() from public,anon,authenticated;

create or replace function public.protect_solicitud_date() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.solicitada_at is not null then
    new.solicitada_at := old.solicitada_at;
    new.course_id := old.course_id;
  end if;
  return new;
end $$;
drop index if exists public.solicitudes_cedula_activa_unique;
create unique index solicitudes_cedula_activa_unique on public.solicitudes_inscripcion(cedula) where cedula is not null and estado in ('pendiente_revision','aprobada');
drop index if exists public.solicitudes_enviadas_pendientes_idx;drop index if exists public.solicitudes_decididas_idx;drop index if exists public.solicitudes_borradores_idx;drop index if exists public.solicitud_documentos_revision_idx;drop index if exists public.solicitudes_estudiante_idx;
alter table public.solicitudes_inscripcion drop column enviada_at;
commit;
