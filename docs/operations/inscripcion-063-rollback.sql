-- MANUAL: restaura 047 y049, no cambia filas ni verificaciones.
begin;
set local lock_timeout='5s';
do $$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.guardar_datos_inscripcion(uuid,jsonb,text,text)')) is distinct from 'c23429eae2e4f50488d43fc74046485e' then raise exception '063 rollback: cuerpo distinto public.guardar_datos_inscripcion(uuid,jsonb,text,text)';end if;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.enviar_solicitud_inscripcion(uuid,text,text,text)')) is distinct from 'cc6d506c0eb22af1d579e37369026618' then raise exception '063 rollback: cuerpo distinto public.enviar_solicitud_inscripcion(uuid,text,text,text)';end if;
end $$;
create or replace function public.guardar_datos_inscripcion(p_id uuid,p_datos jsonb,p_version_aviso text,p_version_terminos text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;c public.solicitud_consentimientos;
 v_min integer;v_edad integer;v_fecha date;v_hoy date;v_nivel text;v_rep jsonb;
 v_cambio boolean;v_rep_cambio boolean;v_marca timestamptz;
begin
 if p_datos is null or jsonb_typeof(p_datos)<>'object' or exists(
  select 1 from jsonb_object_keys(p_datos) k where k not in
   ('nombres','apellidos','cedula','fechaNacimiento','telefono','nacionalidadTipo','tipoSangre','nivelEstudios','representante')) then
  raise exception 'Datos inválidos' using errcode='22023';end if;
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found then raise exception 'No existe solicitud' using errcode='SI404';end if;
 if not s.correo_verificado then raise exception 'Correo no verificado' using errcode='SI401';end if;
 if s.estado not in ('borrador','devuelta') then raise exception 'Solicitud no editable' using errcode='SI409';end if;
 select * into c from public.solicitud_consentimientos where solicitud_id=p_id
  and version_aviso=p_version_aviso and version_terminos=p_version_terminos
  and acepto_tratamiento and declara_veracidad and acepto_terminos for update;
 if not found then raise exception 'Consentimiento no vigente' using errcode='SI403';end if;
 select edad_minima into v_min from public.courses where id=s.course_id for share;
 if not found then raise exception 'Curso no disponible' using errcode='SI428';end if;
 if nullif(p_datos->>'nombres','') is null or nullif(p_datos->>'apellidos','') is null
  or coalesce(p_datos->>'cedula','') !~ '^[0-9]{10}$'
  or coalesce(p_datos->>'fechaNacimiento','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p_datos->>'nacionalidadTipo','') not in ('ecuatoriana','extranjero_con_cedula')
  or coalesce(p_datos->>'tipoSangre','') not in ('A+','A-','B+','B-','AB+','AB-','O+','O-','no_sabe') then
  raise exception 'Datos incompletos' using errcode='SI422';end if;
 v_fecha:=(p_datos->>'fechaNacimiento')::date;
 v_hoy:=(clock_timestamp() at time zone 'America/Guayaquil')::date;
 if v_fecha>v_hoy then raise exception 'Fecha inválida' using errcode='SI427';end if;
 v_edad:=extract(year from age(v_hoy,v_fecha))::integer;
 if v_edad<v_min then raise exception 'Edad inferior a mínimo de curso' using errcode='SI425';end if;
 if v_edad>100 then raise exception 'Edad superior al máximo' using errcode='SI426';end if;
 v_nivel:=case when p_datos ? 'nivelEstudios' then p_datos->>'nivelEstudios' else s.nivel_estudios end;
 if p_datos ? 'nivelEstudios' and (v_nivel is null or v_nivel not in
  ('bachiller','bachiller_reciente','bachiller_exterior','decimo_aprobado','cursando_bachillerato')) then
  raise exception 'Nivel no admitido' using errcode='SI431';end if;
 v_rep:=p_datos->'representante';
 if v_edad<18 then
  if v_rep is null or jsonb_typeof(v_rep)<>'object' or v_rep->'acepta' is distinct from 'true'::jsonb
   or nullif(v_rep->>'nombre','') is null or coalesce(v_rep->>'cedula','') !~ '^[0-9]{10}$'
   or v_rep->>'cedula'=p_datos->>'cedula' then
   raise exception 'Representante requerido' using errcode='SI423';end if;
 elsif v_rep is not null then raise exception 'Representante no aplica' using errcode='SI432';end if;
 -- F13/F15 comparten esta clave al enviar/aprobar; borradores no reservan cédula.
 perform pg_advisory_xact_lock(hashtextextended('cedula_inscripcion:'||(p_datos->>'cedula'),0));
 if exists(select 1 from public.users where cedula=p_datos->>'cedula') or exists(
  select 1 from public.solicitudes_inscripcion where id<>p_id and cedula=p_datos->>'cedula'
   and estado in ('enviada','devuelta','aprobada')) then
  raise exception 'Datos no registrables' using errcode='SI429';end if;
 v_rep_cambio:=row(c.representante_nombre,c.representante_cedula,c.representante_acepta)
  is distinct from row(v_rep->>'nombre',v_rep->>'cedula',v_edad<18);
 v_cambio:=v_rep_cambio or row(s.nombres,s.apellidos,s.cedula,s.fecha_nacimiento,s.telefono,
  s.nacionalidad_tipo,s.tipo_sangre,s.nivel_estudios) is distinct from
  row(p_datos->>'nombres',p_datos->>'apellidos',p_datos->>'cedula',v_fecha,p_datos->>'telefono',
   p_datos->>'nacionalidadTipo',p_datos->>'tipoSangre',v_nivel)
  or s.solicitada_at is null or s.datos_actualizados_at is null;
 if v_cambio then
  v_marca:=clock_timestamp();
  update public.solicitudes_inscripcion set nombres=p_datos->>'nombres',apellidos=p_datos->>'apellidos',
   cedula=p_datos->>'cedula',fecha_nacimiento=v_fecha,telefono=p_datos->>'telefono',
   nacionalidad_tipo=p_datos->>'nacionalidadTipo',tipo_sangre=p_datos->>'tipoSangre',nivel_estudios=v_nivel,
   documento_estudios_pendiente_por_cupo=case when s.nivel_estudios is distinct from v_nivel then false
    else documento_estudios_pendiente_por_cupo end,
   solicitada_at=coalesce(solicitada_at,v_marca),datos_actualizados_at=v_marca where id=p_id;
  update public.solicitud_consentimientos set representante_nombre=v_rep->>'nombre',
   representante_cedula=v_rep->>'cedula',representante_acepta=v_edad<18,
   representante_autoriza_tratamiento=representante_autoriza_tratamiento or v_edad<18 where id=c.id;
  insert into public.solicitud_auditoria(solicitud_id,accion) values(p_id,'datos_actualizados');
 else v_marca:=s.datos_actualizados_at;
 end if;
 return jsonb_build_object('id',p_id,'datosActualizadosAt',v_marca);
end $$;
revoke all on function public.guardar_datos_inscripcion(uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.guardar_datos_inscripcion(uuid,jsonb,text,text) to service_role;
create or replace function public.enviar_solicitud_inscripcion(
  p_id uuid,p_modo text,p_version_aviso text,p_version_terminos text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;c public.solicitud_consentimientos;
 v_min integer;v_edad integer;v_hoy date;v_previo text;v_cert boolean;v_accion text;
begin
 if p_modo is null or p_modo not in ('enviar','reenviar') then
  raise exception 'Modo inválido' using errcode='22023';end if;
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found then raise exception 'No existe solicitud' using errcode='SI404';end if;
 if not s.correo_verificado then raise exception 'Correo no verificado' using errcode='SI401';end if;
 if s.estado='enviada' then
  return jsonb_build_object('id',s.id,'estado','enviada','enviadaAt',s.enviada_at,'transicion',false);end if;
 if s.estado not in ('borrador','devuelta') then
  raise exception 'Solicitud cerrada' using errcode='SI409';end if;
 if (p_modo='enviar' and s.estado<>'borrador') or (p_modo='reenviar' and s.estado<>'devuelta') then
  raise exception 'La acción no corresponde al estado' using errcode='SI435';end if;
 select * into c from public.solicitud_consentimientos where solicitud_id=p_id
  and version_aviso=p_version_aviso and version_terminos=p_version_terminos
  and acepto_tratamiento and declara_veracidad and acepto_terminos for share;
 if not found then raise exception 'Consentimiento no vigente' using errcode='SI403';end if;
 if s.nombres is null or s.apellidos is null or s.cedula is null or s.fecha_nacimiento is null
  or s.tipo_sangre is null or s.nivel_estudios is null or s.solicitada_at is null
  or s.datos_actualizados_at is null
  or coalesce(s.nacionalidad_tipo,'') not in ('ecuatoriana','extranjero_con_cedula')
  then raise exception 'Datos incompletos' using errcode='SI422';end if;
 if s.nivel_estudios not in ('bachiller','bachiller_reciente','bachiller_exterior','decimo_aprobado','cursando_bachillerato') then
  raise exception 'Nivel no admitido' using errcode='SI431';end if;
 select edad_minima into v_min from public.courses where id=s.course_id for share;
 if not found then raise exception 'Curso no disponible' using errcode='SI428';end if;
 v_hoy:=(clock_timestamp() at time zone 'America/Guayaquil')::date;
 v_edad:=extract(year from age(v_hoy,s.fecha_nacimiento))::integer;
 if v_edad<v_min then raise exception 'Edad inferior al mínimo' using errcode='SI425';end if;
 if v_edad>100 then raise exception 'Edad superior al máximo' using errcode='SI426';end if;
 if v_edad<18 and (not c.representante_acepta or not c.representante_autoriza_tratamiento
  or c.representante_nombre is null or c.representante_cedula is null or c.representante_cedula=s.cedula) then
  raise exception 'Representante requerido' using errcode='SI423';end if;
 -- Misma clave que el guardado de datos y la aprobación: serializa la cédula.
 perform pg_advisory_xact_lock(hashtextextended('cedula_inscripcion:'||s.cedula,0));
 if exists(select 1 from public.users where cedula=s.cedula) or exists(
  select 1 from public.solicitudes_inscripcion where id<>p_id and cedula=s.cedula
   and estado in ('enviada','devuelta','aprobada')) then
  raise exception 'Datos no registrables' using errcode='SI429';end if;
 if s.nivel_estudios in ('bachiller_exterior','decimo_aprobado','cursando_bachillerato')
  and not s.documento_estudios_pendiente_por_cupo then
  select exists(select 1 from public.solicitud_documentos d where d.solicitud_id=p_id
   and d.tipo_documento='certificado_estudios' and d.storage_path is not null and d.archivo_eliminado_at is null
   and case s.nivel_estudios when 'bachiller_exterior' then d.subtipo='resolucion_homologacion'
    when 'decimo_aprobado' then d.subtipo='certificado_promocion'
    else d.subtipo='certificado_estudios' end) into v_cert;
  if not v_cert then
   raise exception 'Falta el certificado de estudios' using errcode='SI424',
    detail=jsonb_build_object('faltantes',jsonb_build_array('certificado_estudios'))::text;end if;
 end if;
 v_previo:=s.estado;
 update public.solicitudes_inscripcion set estado='enviada',enviada_at=coalesce(enviada_at,clock_timestamp())
  where id=p_id returning * into s;
 v_accion:=case when v_previo='borrador' then 'solicitud_enviada' else 'solicitud_reenviada' end;
 insert into public.solicitud_auditoria(solicitud_id,accion) values(p_id,v_accion);
 return jsonb_build_object('id',s.id,'estado','enviada','enviadaAt',s.enviada_at,'transicion',true);
end $$;
revoke all on function public.enviar_solicitud_inscripcion(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.enviar_solicitud_inscripcion(uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
