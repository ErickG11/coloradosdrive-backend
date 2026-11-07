-- F13. MANUAL después de048; envío y reenvío atómicos e idempotentes.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.guardar_certificado_inscripcion(uuid,text,timestamptz,text,text,text,integer,text,text,text)') is null
  then raise exception '049 requiere 042–048 completas';end if;
end $$;
-- Una sola transición: borrador→enviada (modo enviar) o devuelta→enviada (modo reenviar).
-- Repetir sobre una solicitud ya enviada no cambia nada y devuelve transicion=false, para
-- que el backend no repita el correo. Revalida consentimiento, datos, edad, cédula y archivo.
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
