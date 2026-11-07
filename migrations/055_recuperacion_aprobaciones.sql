-- F44-c. MANUAL después de054. Intención durable antes de llamar a Auth.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.confirmar_identidad_presencial(uuid,uuid,boolean)') is null
 or to_regprocedure('public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text)') is null then
 raise exception '055 requiere052 y054 completas';end if;
end $$;
-- Sin FK al expediente: permite compensar Auth incluso si el expediente fue purgado.
-- Solo identificadores técnicos; no correo, contraseña ni token de acceso.
create table if not exists public.solicitud_aprobacion_intentos(
 id uuid primary key default gen_random_uuid(),solicitud_id uuid not null,actor_id uuid not null,
 claim timestamptz not null,estado text not null default 'pendiente'
 check(estado in ('pendiente','recuperando','completado','compensado','revision_manual')),
 recovery_token uuid,updated_at timestamptz not null default clock_timestamp(),resuelto_at timestamptz,
 unique(solicitud_id,claim));
create index if not exists solicitud_aprobacion_recuperacion_idx on public.solicitud_aprobacion_intentos(estado,updated_at);
alter table public.solicitud_aprobacion_intentos enable row level security;
revoke all on public.solicitud_aprobacion_intentos from public,anon,authenticated;
grant select,insert,update on public.solicitud_aprobacion_intentos to service_role;
create or replace function public.reclamar_aprobacion_inscripcion(
  p_id uuid,p_actor uuid,p_verif_identidad uuid,p_verif_estudios uuid,p_version_aviso text,p_version_terminos text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;v_intento uuid;
begin
 if p_actor is null then raise exception 'Actor inválido' using errcode='22023';end if;
 perform 1 from public.solicitudes_inscripcion where id=p_id for update;
 if not found then raise exception 'No existe solicitud' using errcode='SI404';end if;
 perform public.validar_aprobacion_inscripcion(p_id,p_verif_identidad,p_verif_estudios,p_version_aviso,p_version_terminos);
 update public.solicitudes_inscripcion set reviewed_by=p_actor,reviewed_at=clock_timestamp()
  where id=p_id returning * into s;
 insert into public.solicitud_aprobacion_intentos(solicitud_id,actor_id,claim)
 values(p_id,p_actor,s.reviewed_at) returning id into v_intento;
 return jsonb_build_object('authUserId',v_intento,'claim',s.reviewed_at,'correo',s.correo,'courseId',s.course_id,
  'solicitadaAt',s.solicitada_at);
end $$;
revoke all on function public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text) to service_role;


-- La confirmación original y el recuperador toman primero la fila de solicitud.
-- Una recuperación tomada invalida la finalización antigua antes de cualquier commit.
create or replace function public.guard_aprobacion_intento() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.solicitud_aprobacion_intentos;
begin
 if old.estado='enviada' and new.estado='aprobada' then
  select * into r from public.solicitud_aprobacion_intentos where solicitud_id=old.id
   and claim=old.reviewed_at and actor_id=old.reviewed_by for update;
  if not found or r.estado<>'pendiente' or r.id is distinct from new.student_id then
   raise exception 'Intento de aprobación no vigente' using errcode='SI409';end if;
  update public.solicitud_aprobacion_intentos set estado='completado',resuelto_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
 end if;
 return new;
end $$;
drop trigger if exists solicitudes_aprobacion_intento on public.solicitudes_inscripcion;
create trigger solicitudes_aprobacion_intento before update on public.solicitudes_inscripcion
 for each row execute function public.guard_aprobacion_intento();
revoke all on function public.guard_aprobacion_intento() from public,anon,authenticated;
grant execute on function public.guard_aprobacion_intento() to service_role;

create or replace function public.tomar_recuperacion_aprobacion(p_intento uuid,p_ttl integer,p_forzar boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.solicitud_aprobacion_intentos;s public.solicitudes_inscripcion;v_sol uuid;v_token uuid;
begin
 if p_ttl is null or p_ttl not between 1 and 1440 then raise exception 'TTL inválido' using errcode='22023';end if;
 select solicitud_id into v_sol from public.solicitud_aprobacion_intentos where id=p_intento;
 if not found then return null;end if;
 select * into s from public.solicitudes_inscripcion where id=v_sol for update;
 select * into r from public.solicitud_aprobacion_intentos where id=p_intento for update;
 if r.estado in ('completado','revision_manual') then return null;end if;
 if (not coalesce(p_forzar,false) or r.estado<>'pendiente') and r.updated_at>clock_timestamp()-make_interval(mins=>p_ttl) then return null;end if;
 if s.estado='aprobada' and s.student_id=r.id then
  update public.solicitud_aprobacion_intentos set estado='completado',resuelto_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  return null;
 end if;
 if exists(select 1 from public.users where id=r.id) then
  update public.solicitud_aprobacion_intentos set estado='revision_manual',updated_at=clock_timestamp() where id=r.id;
  insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(r.solicitud_id,r.actor_id,'aprobacion_recuperacion_revision_manual');
  return null;
 end if;
 v_token:=gen_random_uuid();
 update public.solicitud_aprobacion_intentos set estado='recuperando',recovery_token=v_token,updated_at=clock_timestamp() where id=r.id;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(r.solicitud_id,r.actor_id,'aprobacion_recuperacion_iniciada');
 return jsonb_build_object('intentoId',r.id,'solicitudId',r.solicitud_id,'token',v_token);
end $$;

create or replace function public.cerrar_recuperacion_aprobacion(p_intento uuid,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.solicitud_aprobacion_intentos;v_sol uuid;
begin
 select solicitud_id into v_sol from public.solicitud_aprobacion_intentos where id=p_intento;
 perform 1 from public.solicitudes_inscripcion where id=v_sol for update;
 select * into r from public.solicitud_aprobacion_intentos where id=p_intento for update;
 if not found or r.estado<>'recuperando' or r.recovery_token is distinct from p_token then return false;end if;
 if exists(select 1 from public.users where id=r.id) then raise exception 'Cuenta con perfil: no liberar' using errcode='SI409';end if;
 update public.solicitudes_inscripcion set reviewed_by=null,reviewed_at=null where id=r.solicitud_id
  and estado='enviada' and reviewed_by=r.actor_id and reviewed_at=r.claim;
 if r.resuelto_at is null then insert into public.solicitud_auditoria(solicitud_id,actor_id,accion)
  values(r.solicitud_id,r.actor_id,'aprobacion_compensada');end if;
 update public.solicitud_aprobacion_intentos set estado='compensado',recovery_token=null,
  resuelto_at=coalesce(resuelto_at,clock_timestamp()),updated_at=clock_timestamp() where id=r.id;
 return true;
end $$;

create or replace function public.liberar_reclamo_aprobacion_legacy(p_id uuid,p_claim timestamptz,p_ttl integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;
begin
 if p_ttl is null or p_ttl not between 1 and 1440 then raise exception 'TTL inválido' using errcode='22023';end if;
 select * into s from public.solicitudes_inscripcion where id=p_id and estado='enviada'
  and reviewed_at=p_claim and reviewed_at<clock_timestamp()-make_interval(mins=>p_ttl) for update;
 if not found or exists(select 1 from public.solicitud_aprobacion_intentos where solicitud_id=p_id and claim=p_claim) then return false;end if;
 if public.correo_tiene_cuenta(s.correo) then
  if not exists(select 1 from public.solicitud_auditoria where solicitud_id=p_id and accion='aprobacion_legacy_revision_manual') then
   insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(p_id,s.reviewed_by,'aprobacion_legacy_revision_manual');end if;
  return false;
 end if;
 update public.solicitudes_inscripcion set reviewed_by=null,reviewed_at=null where id=p_id;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(p_id,s.reviewed_by,'aprobacion_reclamo_vencido');
 return true;
end $$;
revoke all on function public.tomar_recuperacion_aprobacion(uuid,integer,boolean),public.cerrar_recuperacion_aprobacion(uuid,uuid),public.liberar_reclamo_aprobacion_legacy(uuid,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.tomar_recuperacion_aprobacion(uuid,integer,boolean),public.cerrar_recuperacion_aprobacion(uuid,uuid),public.liberar_reclamo_aprobacion_legacy(uuid,timestamptz,integer) to service_role;
notify pgrst,'reload schema';
commit;
