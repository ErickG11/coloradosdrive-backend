-- T43. Aplicación MANUAL después de 039. No ejecutar desde la aplicación.
begin;
set local lock_timeout = '5s';
alter table public.solicitudes_inscripcion add column if not exists enviada_at timestamptz;
-- Solo expedientes con datos y los DOS documentos obligatorios. No cambia decisiones.
update public.solicitudes_inscripcion s set enviada_at = d.fecha
from (select solicitud_id,max(uploaded_at) fecha from public.solicitud_documentos
      where tipo_documento in ('cedula','titulo_bachiller') group by solicitud_id
      having count(distinct tipo_documento)=2) d
where s.id=d.solicitud_id and s.cedula is not null and s.solicitada_at is not null and s.enviada_at is null;
create index if not exists solicitudes_enviadas_pendientes_idx on public.solicitudes_inscripcion(enviada_at,id)
 where enviada_at is not null and estado='pendiente_revision';
create index if not exists solicitudes_decididas_idx on public.solicitudes_inscripcion(reviewed_at desc,id)
 where enviada_at is not null and estado<>'pendiente_revision';
create index if not exists solicitudes_borradores_idx on public.solicitudes_inscripcion(created_at,id)
 where enviada_at is null and estado='pendiente_revision';
create index if not exists solicitud_documentos_revision_idx on public.solicitud_documentos(solicitud_id,id) where estado='recibido';
drop index if exists public.solicitudes_cedula_activa_unique;
create unique index solicitudes_cedula_activa_unique on public.solicitudes_inscripcion(cedula) where cedula is not null and (enviada_at is not null or estado='aprobada') and estado<>'rechazada';
create unique index if not exists solicitudes_estudiante_idx on public.solicitudes_inscripcion(student_id) where student_id is not null;

create or replace function public.correo_tiene_cuenta(p_correo text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where lower(email)=lower(trim(p_correo)))
$$;
revoke all on function public.correo_tiene_cuenta(text) from public,anon,authenticated;
grant execute on function public.correo_tiene_cuenta(text) to service_role;

create or replace function public.protect_solicitud_date() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.solicitada_at is not null then new.solicitada_at:=old.solicitada_at;new.course_id:=old.course_id;end if;
 if old.enviada_at is not null or old.estado<>'pendiente_revision' then
   if row(new.cedula,new.nombre_completo,new.telefono,new.fecha_nacimiento,new.course_id)
     is distinct from row(old.cedula,old.nombre_completo,old.telefono,old.fecha_nacimiento,old.course_id) then
     raise exception 'Los datos de la solicitud ya no se pueden editar' using errcode='SI410';
   end if;
 end if;
 if old.enviada_at is not null then new.enviada_at:=old.enviada_at;end if;
 if new.estado<>old.estado and old.enviada_at is null then
   raise exception 'La solicitud no ha sido enviada' using errcode='SI413';
 end if;
 return new;
end $$;

create or replace function public.guard_solicitud_edit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;
begin
 select * into s from public.solicitudes_inscripcion where id=new.solicitud_id for update;
 if not found or s.estado='rechazada' or (s.estado='pendiente_revision' and s.reviewed_at is not null) then
   raise exception 'La solicitud está cerrada o en resolución' using errcode='SI409';
 end if;
 if tg_table_name='solicitud_consentimientos' then
   if s.enviada_at is not null then raise exception 'La solicitud ya fue enviada' using errcode='SI410';end if;
   if s.estado<>'pendiente_revision' then raise exception 'Solicitud cerrada' using errcode='SI409';end if;
 elsif tg_op='UPDATE' then
   if old.estado='aprobado' then raise exception 'Documento aprobado' using errcode='SI412';end if;
   if old.estado='rechazado' and not(new.estado='recibido' and new.storage_path<>old.storage_path) then
     raise exception 'Documento ya revisado' using errcode='SI411';
   end if;
 end if;
 return new;
end $$;

create function public.enviar_solicitud(p_id uuid,p_version text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;c public.solicitud_consentimientos; faltantes text[];
begin
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found then raise exception 'Solicitud inexistente' using errcode='SI404';end if;
 if not s.correo_verificado then raise exception 'Verifica tu correo' using errcode='SI401';end if;
 if s.enviada_at is not null then return jsonb_build_object('id',s.id,'estado',case when s.estado='pendiente_revision' then 'enviada' else s.estado::text end,'enviadaAt',s.enviada_at);end if;
 if s.estado<>'pendiente_revision' or s.reviewed_at is not null then raise exception 'Solicitud cerrada' using errcode='SI409';end if;
 select * into c from public.solicitud_consentimientos where solicitud_id=p_id and version_aviso=p_version and acepto_tratamiento and declara_veracidad;
 if not found then raise exception 'Acepta el consentimiento vigente' using errcode='SI403';end if;
 if s.cedula is null or s.nombre_completo is null or s.fecha_nacimiento is null or s.solicitada_at is null then raise exception 'Completa tus datos personales' using errcode='SI422';end if;
 if date_part('year',age((now() at time zone 'America/Guayaquil')::date,s.fecha_nacimiento))<18 and
   (not c.representante_acepta or c.representante_nombre is null or c.representante_cedula is null or c.representante_cedula=s.cedula) then
   raise exception 'Completa los datos del representante' using errcode='SI423';end if;
 select array_agg(tipo) into faltantes from unnest(array['cedula','titulo_bachiller']) tipo
 where not exists(select 1 from public.solicitud_documentos where solicitud_id=p_id and tipo_documento=tipo);
 if faltantes is not null then raise exception 'Faltan documentos obligatorios' using errcode='SI424',detail=jsonb_build_object('faltantes',faltantes)::text;end if;
 update public.solicitudes_inscripcion set enviada_at=now() where id=p_id returning * into s;
 insert into public.solicitud_auditoria(solicitud_id,accion) values(p_id,'solicitud_enviada');
 return jsonb_build_object('id',s.id,'estado','enviada','enviadaAt',s.enviada_at);
end $$;
revoke all on function public.enviar_solicitud(uuid,text) from public,anon,authenticated;
grant execute on function public.enviar_solicitud(uuid,text) to service_role;

create view public.solicitudes_admin with (security_invoker=true) as
 select s.*,
 (select count(*)::integer from public.solicitud_documentos d where d.solicitud_id=s.id and d.estado='recibido') documentos_por_revisar,
 case when s.estado='pendiente_revision' then 0 else 1 end orden_grupo,
 case when s.estado='pendiente_revision' then s.enviada_at end pendiente_desde,
 case when s.estado<>'pendiente_revision' then s.reviewed_at end decidida_at
 from public.solicitudes_inscripcion s where s.enviada_at is not null;
revoke all on public.solicitudes_admin from public,anon,authenticated;
grant select on public.solicitudes_admin to service_role;
create function public.resumen_solicitudes() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('pendientes',(select count(*) from public.solicitudes_inscripcion where enviada_at is not null and estado='pendiente_revision'),
 'documentosPorRevisar',(select count(*) from public.solicitud_documentos d join public.solicitudes_inscripcion s on s.id=d.solicitud_id where d.estado='recibido' and s.enviada_at is not null and s.estado in ('pendiente_revision','aprobada')))
$$;
revoke all on function public.resumen_solicitudes() from public,anon,authenticated;
grant execute on function public.resumen_solicitudes() to service_role;
create or replace function public.finalizar_aprobacion_solicitud(p_solicitud uuid, p_actor uuid, p_claim timestamptz, p_student uuid, p_enrollment uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;
begin
 select * into s from public.solicitudes_inscripcion where id=p_solicitud
   and enviada_at is not null and estado='pendiente_revision' and reviewed_by=p_actor and reviewed_at=p_claim for update;
 if not found then raise exception 'La solicitud está cerrada o en resolución' using errcode='SI409'; end if;
 if not exists(select 1 from public.solicitud_consentimientos where solicitud_id=s.id
   and acepto_tratamiento and declara_veracidad) then
   raise exception 'Consentimiento ausente' using errcode='SI403'; end if;
 if not exists(select 1 from public.enrollments where id=p_enrollment and student_id=p_student and course_id=s.course_id) then
   raise exception 'Matrícula no corresponde a solicitud' using errcode='SI409'; end if;
 insert into public.enrollment_documents(enrollment_id,tipo,estado)
 select p_enrollment,tipo,case when tipo='papeleta_votacion'
   and date_part('year',age((now() at time zone 'America/Guayaquil')::date,s.fecha_nacimiento))>=65 then 'no_aplica' else 'pendiente' end
 from unnest(array['cedula','papeleta_votacion','tipo_sangre','titulo_bachiller']) tipo
 on conflict(enrollment_id,tipo) do nothing;
 update public.solicitudes_inscripcion set estado='aprobada',student_id=p_student,motivo_rechazo=null where id=s.id;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(s.id,p_actor,'solicitud_aprobada');
end $$;
revoke all on function public.finalizar_aprobacion_solicitud(uuid,uuid,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalizar_aprobacion_solicitud(uuid,uuid,timestamptz,uuid,uuid) to service_role;

commit;
