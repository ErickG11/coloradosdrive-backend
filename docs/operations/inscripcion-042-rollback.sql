-- Rollback MANUAL de 042; primero revertir migraciones posteriores y parar backend.
-- No usa CASCADE ni borra datos nuevos. Repetir tras rollback es un no-op.
begin;
set local lock_timeout = '5s';
lock table public.solicitudes_inscripcion in access exclusive mode;
do $rollback$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='solicitudes_inscripcion' and column_name='correo_normalizado') then return; end if;

  if exists(select 1 from public.solicitud_verificaciones)
    or exists(select 1 from public.correo_bloqueado)
    or exists(select 1 from public.enrollment_counters)
    or exists(select 1 from public.enrollment_rate_events)
    or exists(select 1 from public.app_settings where not inscripciones_abiertas or updated_by is not null)
    or exists(select 1 from public.solicitudes_inscripcion where estado='devuelta' or nombres is not null
      or apellidos is not null or nacionalidad_tipo is not null or tipo_sangre is not null
      or nivel_estudios is not null or devuelta_at is not null or devuelta_por is not null
      or rechazo_motivo_codigo is not null or rechazo_nota_interna is not null
      or devolucion_motivo_codigo is not null or devolucion_mensaje is not null
      or devolucion_nota_interna is not null or documento_estudios_pendiente_por_cupo)
    or exists(select 1 from public.solicitud_documentos where tipo_documento='certificado_estudios'
      or subtipo is not null or mime_type is not null or size_bytes is not null or sha256 is not null
      or archivo_verificado_at is not null or archivo_eliminado_at is not null)
    or exists(select 1 from public.courses where edad_minima<>18)
    or exists(select 1 from public.enrollments where origen<>'manual' or requisitos_verificados_at is not null
      or identidad_presencial_at is not null or certificado_original_visto)
    or exists(select 1 from public.solicitud_consentimientos where version_terminos is not null or acepto_terminos) then
    raise exception 'Rollback 042 cancelado: existen datos nuevos. Exportar y reconciliar; nunca se borran automáticamente';
  end if;
  execute $ddl$
drop view if exists public.solicitudes_admin;
drop trigger if exists solicitudes_fecha_inmutable on public.solicitudes_inscripcion;
alter table public.solicitudes_inscripcion drop constraint if exists solicitudes_estado_valido;
update public.solicitudes_inscripcion set estado='pendiente_revision' where estado in ('borrador','enviada');
alter table public.solicitudes_inscripcion alter column estado set default 'pendiente_revision';
alter table public.solicitudes_inscripcion add constraint solicitudes_estado_valido
  check (estado in ('pendiente_revision','aprobada','rechazada'));
alter table public.solicitudes_inscripcion drop constraint if exists solicitudes_datos_finales_catalogos,
  drop constraint if exists solicitudes_motivos_finales;
drop index if exists public.solicitudes_correo_normalizado_unique;
create unique index if not exists solicitudes_correo_unique on public.solicitudes_inscripcion(lower(correo));
drop index if exists public.solicitudes_cedula_activa_unique;
create unique index solicitudes_cedula_activa_unique on public.solicitudes_inscripcion(cedula)
  where cedula is not null and (enviada_at is not null or estado='aprobada') and estado<>'rechazada';
drop index if exists public.solicitudes_enviadas_pendientes_idx;
create index solicitudes_enviadas_pendientes_idx on public.solicitudes_inscripcion(enviada_at,id)
  where enviada_at is not null and estado='pendiente_revision';
drop index if exists public.solicitudes_borradores_idx;
create index solicitudes_borradores_idx on public.solicitudes_inscripcion(created_at,id)
  where enviada_at is null and estado='pendiente_revision';
drop index if exists public.solicitudes_devueltas_idx;
alter table public.solicitudes_inscripcion
  drop column if exists nombres, drop column if exists apellidos, drop column if exists nacionalidad_tipo,
  drop column if exists tipo_sangre, drop column if exists nivel_estudios, drop column if exists devuelta_at,
  drop column if exists devuelta_por, drop column if exists devolucion_motivo_codigo,
  drop column if exists devolucion_mensaje, drop column if exists devolucion_nota_interna,
  drop column if exists rechazo_motivo_codigo, drop column if exists rechazo_nota_interna,
  drop column if exists documento_estudios_pendiente_por_cupo, drop column if exists correo_normalizado;
alter table public.solicitud_consentimientos drop column if exists version_terminos,
  drop column if exists acepto_terminos;
alter table public.solicitud_documentos drop constraint if exists solicitud_certificado_formato,
  drop constraint if exists solicitud_documentos_tipo_valido;
alter table public.solicitud_documentos add constraint solicitud_documentos_tipo_valido
  check (tipo_documento in ('cedula','papeleta_votacion','tipo_sangre','titulo_bachiller'));
alter table public.solicitud_documentos alter column storage_path set not null,
  drop column if exists subtipo, drop column if exists mime_type, drop column if exists size_bytes,
  drop column if exists sha256, drop column if exists archivo_verificado_at, drop column if exists archivo_eliminado_at;
alter table public.courses drop column if exists edad_minima;
alter table public.enrollments drop column if exists origen, drop column if exists requisitos_verificados_at,
  drop column if exists identidad_presencial_at, drop column if exists identidad_presencial_por,
  drop column if exists certificado_original_visto;
drop table if exists public.solicitud_verificaciones;
drop function if exists public.impedir_cambio_verificacion();
drop table if exists public.correo_bloqueado;
drop table if exists public.app_settings;
drop table if exists public.enrollment_counters;
drop table if exists public.enrollment_rate_events;
drop function if exists public.consumir_cupo_inscripcion(text,integer);
drop function if exists public.normalizar_correo_inscripcion(text);
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
create trigger solicitudes_fecha_inmutable before update on public.solicitudes_inscripcion for each row execute function public.protect_solicitud_date();
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
create view public.solicitudes_admin with (security_invoker=true) as
 select s.*,
 case when s.estado in ('pendiente_revision','aprobada') then (select count(*)::integer from public.solicitud_documentos d where d.solicitud_id=s.id and d.estado='recibido') else 0 end documentos_por_revisar,
 case when s.estado='pendiente_revision' then 0 else 1 end orden_grupo,
 case when s.estado='pendiente_revision' then s.enviada_at end pendiente_desde,
 case when s.estado<>'pendiente_revision' then s.reviewed_at end decidida_at
 from public.solicitudes_inscripcion s where s.enviada_at is not null;
revoke all on public.solicitudes_admin from public,anon,authenticated;
grant select on public.solicitudes_admin to service_role;
create or replace function public.resumen_solicitudes() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('pendientes',(select count(*) from public.solicitudes_inscripcion where enviada_at is not null and estado='pendiente_revision'),
 'documentosPorRevisar',(select count(*) from public.solicitud_documentos d join public.solicitudes_inscripcion s on s.id=d.solicitud_id where d.estado='recibido' and s.enviada_at is not null and s.estado in ('pendiente_revision','aprobada')))
$$;
revoke all on function public.resumen_solicitudes() from public,anon,authenticated;
grant execute on function public.resumen_solicitudes() to service_role;
notify pgrst, 'reload schema';
$ddl$;
end $rollback$;
commit;
