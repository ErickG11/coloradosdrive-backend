-- F10. Aplicación MANUAL después de 045; no presume aceptación de términos legacy.
begin;
set local lock_timeout = '5s';
do $$ begin
 if to_regprocedure('public.confirmar_codigo_inscripcion(text,text,text,jsonb)') is null
   or not exists(select 1 from information_schema.columns where table_schema='public'
     and table_name='solicitud_consentimientos' and column_name='acepto_terminos') then
  raise exception '046 requiere 042–045 completas';
 end if;
end $$;
-- Autorización de tratamiento del representante en el paso de consentimiento.
-- Los datos de identidad y su CHECK original se conservan para el paso de datos.
alter table public.solicitud_consentimientos
 add column if not exists representante_autoriza_tratamiento boolean not null default false;
alter table public.solicitud_consentimientos
 drop constraint if exists solicitud_consentimientos_solicitud_id_version_aviso_key;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.solicitud_consentimientos'::regclass
   and conname='solicitud_consentimientos_versiones_key') then
  alter table public.solicitud_consentimientos add constraint solicitud_consentimientos_versiones_key
   unique(solicitud_id,version_aviso,version_terminos);
 end if;
end $$;
create or replace function public.aceptar_consentimiento_inscripcion(
 p_id uuid,p_version_aviso text,p_version_terminos text,p_representante boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;c public.solicitud_consentimientos;v_cambio boolean;
begin
 if p_version_aviso is null or length(trim(p_version_aviso)) not between 1 and 100
   or p_version_terminos is null or length(trim(p_version_terminos)) not between 1 and 100
   or p_representante is null then raise exception 'Versiones inválidas' using errcode='22023';end if;
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found then raise exception 'No existe solicitud' using errcode='SI404';end if;
 if not s.correo_verificado then raise exception 'Correo no verificado' using errcode='SI401';end if;
 if s.estado not in ('borrador','devuelta') then raise exception 'Solicitud no editable' using errcode='SI409';end if;
 insert into public.solicitud_consentimientos(solicitud_id,version_aviso,version_terminos,
   acepto_tratamiento,declara_veracidad,acepto_terminos,representante_autoriza_tratamiento)
 values(p_id,p_version_aviso,p_version_terminos,true,true,true,p_representante)
 on conflict(solicitud_id,version_aviso,version_terminos) do nothing returning * into c;
 v_cambio:=found;
 if not v_cambio then
  select * into c from public.solicitud_consentimientos where solicitud_id=p_id
   and version_aviso=p_version_aviso and version_terminos=p_version_terminos;
  -- No se infiere aceptación de una fila incompleta preexistente.
  if not c.acepto_tratamiento or not c.declara_veracidad or not c.acepto_terminos then
   raise exception 'Consentimiento incompleto' using errcode='SI403';end if;
  if p_representante and not c.representante_autoriza_tratamiento then
   update public.solicitud_consentimientos set representante_autoriza_tratamiento=true
    where id=c.id returning * into c;
   v_cambio:=true;
  end if;
 end if;
 if v_cambio then insert into public.solicitud_auditoria(solicitud_id,accion)
  values(p_id,'consentimiento_aceptado');end if;
 return jsonb_build_object('version',c.version_aviso,'versionAviso',c.version_aviso,
  'versionTerminos',c.version_terminos,'aceptadoAt',c.aceptado_at);
end $$;
revoke all on function public.aceptar_consentimiento_inscripcion(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.aceptar_consentimiento_inscripcion(uuid,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
