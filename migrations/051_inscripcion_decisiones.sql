-- F15. MANUAL después de 050. Decisiones del admin: devolver, rechazar y validar la aprobación.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.registrar_verificacion_inscripcion(uuid,uuid,text,text,text,text,boolean)') is null
  or to_regclass('public.correo_bloqueado') is null then
  raise exception '051 requiere 042–050 completas';end if;
end $$;

-- Devolver (corregible): solo desde enviada y sin decisión en curso. No toca los datos del postulante.
create or replace function public.devolver_solicitud_inscripcion(
  p_id uuid,p_actor uuid,p_motivo text,p_mensaje text,p_nota text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;
begin
 if p_actor is null or p_motivo is null or p_motivo not in ('DATOS_NO_COINCIDEN_REGISTRO_CIVIL','CEDULA_MAL_ESCRITA',
  'TITULO_NO_ENCONTRADO_ADJUNTAR_DOCUMENTO','DOCUMENTO_ILEGIBLE_O_INCOMPLETO','REQUIERE_DOCUMENTO_ESTUDIOS','OTRO')
  or p_mensaje is null or char_length(p_mensaje) not between 10 and 300
  or (p_nota is not null and char_length(p_nota)>1000) then
  raise exception 'Decisión inválida' using errcode='22023';end if;
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found or s.estado='borrador' then raise exception 'No existe solicitud' using errcode='SI404';end if;
 if s.estado<>'enviada' then raise exception 'La acción no corresponde al estado' using errcode='SI435';end if;
 if s.reviewed_at is not null then raise exception 'Decisión en curso' using errcode='SI409';end if;
 update public.solicitudes_inscripcion set estado='devuelta',devuelta_at=clock_timestamp(),devuelta_por=p_actor,
  devolucion_motivo_codigo=p_motivo,devolucion_mensaje=p_mensaje,devolucion_nota_interna=p_nota
  where id=p_id;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(p_id,p_actor,'solicitud_devuelta');
 return jsonb_build_object('id',p_id,'estado','devuelta','correo',s.correo);
end $$;
revoke all on function public.devolver_solicitud_inscripcion(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.devolver_solicitud_inscripcion(uuid,uuid,text,text,text) to service_role;

-- Rechazar (definitivo). VENCIDA solo la aplica el trabajo programado (F20). SPAM bloquea el
-- correo guardando únicamente su hash HMAC; el bloqueo nunca se acorta.
create or replace function public.rechazar_solicitud_inscripcion(
  p_id uuid,p_actor uuid,p_motivo text,p_mensaje text,p_nota text,p_bloqueo_hash text,p_bloqueo_dias integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;
begin
 if p_actor is null or p_motivo is null or p_motivo not in ('NO_CUMPLE_NIVEL_ESTUDIOS','NO_CUMPLE_EDAD',
  'SOLICITUD_DUPLICADA','DATOS_INCONSISTENTES_O_FALSOS','SPAM','OTRO')
  or p_mensaje is null or char_length(p_mensaje) not between 10 and 300
  or (p_nota is not null and char_length(p_nota)>1000)
  or (p_motivo='SPAM' and (p_bloqueo_hash is null or p_bloqueo_hash!~'^[a-f0-9]{64}$'
   or p_bloqueo_dias is null or p_bloqueo_dias not between 1 and 365)) then
  raise exception 'Decisión inválida' using errcode='22023';end if;
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found or s.estado='borrador' then raise exception 'No existe solicitud' using errcode='SI404';end if;
 if s.estado<>'enviada' then raise exception 'La acción no corresponde al estado' using errcode='SI435';end if;
 if s.reviewed_at is not null then raise exception 'Decisión en curso' using errcode='SI409';end if;
 update public.solicitudes_inscripcion set estado='rechazada',rechazo_motivo_codigo=p_motivo,motivo_rechazo=p_mensaje,
  rechazo_nota_interna=p_nota,reviewed_by=p_actor,reviewed_at=clock_timestamp() where id=p_id;
 if p_motivo='SPAM' then
  insert into public.correo_bloqueado(correo_hash,hasta)
   values(p_bloqueo_hash,clock_timestamp()+make_interval(days=>p_bloqueo_dias))
   on conflict(correo_hash) do update set hasta=greatest(public.correo_bloqueado.hasta,excluded.hasta);
 end if;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(p_id,p_actor,'solicitud_rechazada');
 return jsonb_build_object('id',p_id,'estado','rechazada','correo',s.correo);
end $$;
revoke all on function public.rechazar_solicitud_inscripcion(uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.rechazar_solicitud_inscripcion(uuid,uuid,text,text,text,text,integer) to service_role;

-- Requisitos de la aprobación que dependen de datos persistidos. El backend verifica antes que los
-- MÉTODOS de las dos verificaciones habiliten (catálogo en TypeScript) y pasa sus ids; aquí se
-- comprueba que siguen siendo las más recientes, «verificado» y posteriores al último cambio de
-- datos y del certificado. Se invoca con la solicitud bloqueada desde la reclamación (052).
create or replace function public.validar_aprobacion_inscripcion(
  p_id uuid,p_verif_identidad uuid,p_verif_estudios uuid,p_version_aviso text,p_version_terminos text)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;c public.solicitud_consentimientos;d public.solicitud_documentos;
 vi public.solicitud_verificaciones;ve public.solicitud_verificaciones;
 v_min integer;v_edad integer;v_hoy date;v_obligatorio boolean;
begin
 select * into s from public.solicitudes_inscripcion where id=p_id;
 if not found or s.estado='borrador' then raise exception 'No existe solicitud' using errcode='SI404';end if;
 if s.estado<>'enviada' then raise exception 'La acción no corresponde al estado' using errcode='SI435';end if;
 if s.reviewed_at is not null then raise exception 'Decisión en curso' using errcode='SI409';end if;
 if not s.correo_verificado then raise exception 'Correo no verificado' using errcode='SI401';end if;
 select * into c from public.solicitud_consentimientos where solicitud_id=p_id
  and version_aviso=p_version_aviso and version_terminos=p_version_terminos
  and acepto_tratamiento and declara_veracidad and acepto_terminos;
 if not found then raise exception 'Consentimiento no vigente' using errcode='SI403';end if;
 if s.nombres is null or s.apellidos is null or s.cedula is null or s.fecha_nacimiento is null
  or s.tipo_sangre is null or s.nivel_estudios is null or s.solicitada_at is null
  or s.datos_actualizados_at is null
  or coalesce(s.nacionalidad_tipo,'') not in ('ecuatoriana','extranjero_con_cedula') then
  raise exception 'Datos incompletos' using errcode='SI422';end if;
 if s.nivel_estudios not in ('bachiller','bachiller_reciente','bachiller_exterior','decimo_aprobado','cursando_bachillerato') then
  raise exception 'Nivel no admitido' using errcode='SI431';end if;
 select edad_minima into v_min from public.courses where id=s.course_id;
 if not found then raise exception 'Curso no disponible' using errcode='SI428';end if;
 v_hoy:=(clock_timestamp() at time zone 'America/Guayaquil')::date;
 v_edad:=extract(year from age(v_hoy,s.fecha_nacimiento))::integer;
 if v_edad<v_min then raise exception 'Edad inferior al mínimo' using errcode='SI425';end if;
 if v_edad>100 then raise exception 'Edad superior al máximo' using errcode='SI426';end if;
 if v_edad<18 and (not c.representante_acepta or not c.representante_autoriza_tratamiento
  or c.representante_nombre is null or c.representante_cedula is null or c.representante_cedula=s.cedula) then
  raise exception 'Representante requerido' using errcode='SI423';end if;
 -- Certificado: obligatorio según nivel (un tope agotado no lo sustituye) y compatible con el subtipo.
 v_obligatorio:=s.nivel_estudios in ('bachiller_exterior','decimo_aprobado','cursando_bachillerato');
 select * into d from public.solicitud_documentos where solicitud_id=p_id and tipo_documento='certificado_estudios';
 if v_obligatorio and (not found or d.storage_path is null or d.archivo_eliminado_at is not null
  or d.subtipo is distinct from case s.nivel_estudios when 'bachiller_exterior' then 'resolucion_homologacion'
   when 'decimo_aprobado' then 'certificado_promocion' else 'certificado_estudios' end) then
  raise exception 'Falta el certificado de estudios' using errcode='SI424',
   detail=jsonb_build_object('faltantes',jsonb_build_array('certificado_estudios'))::text;end if;
 select * into vi from public.solicitud_verificaciones where solicitud_id=p_id and tipo='identidad'
  order by creado_at desc,id desc limit 1;
 if not found or vi.id is distinct from p_verif_identidad or vi.resultado<>'verificado'
  or vi.creado_at<s.datos_actualizados_at then
  raise exception 'Identidad no verificada' using errcode='SI461';end if;
 select * into ve from public.solicitud_verificaciones where solicitud_id=p_id and tipo='estudios'
  order by creado_at desc,id desc limit 1;
 if not found or ve.id is distinct from p_verif_estudios or ve.resultado<>'verificado'
  or ve.creado_at<s.datos_actualizados_at or (d.id is not null and ve.creado_at<d.uploaded_at) then
  raise exception 'Estudios no verificados' using errcode='SI462';end if;
 -- Misma clave que el guardado de datos y el envío: serializa la cédula entre solicitudes.
 perform pg_advisory_xact_lock(hashtextextended('cedula_inscripcion:'||s.cedula,0));
 if exists(select 1 from public.users where cedula=s.cedula) or exists(
  select 1 from public.solicitudes_inscripcion where id<>p_id and cedula=s.cedula
   and estado in ('enviada','devuelta','aprobada')) then
  raise exception 'Cédula ya registrada' using errcode='SI460';end if;
end $$;
revoke all on function public.validar_aprobacion_inscripcion(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.validar_aprobacion_inscripcion(uuid,uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
