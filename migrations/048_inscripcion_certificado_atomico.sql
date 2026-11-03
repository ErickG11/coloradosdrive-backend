-- F12. MANUAL después de047; guarda el certificado de estudios de forma atómica.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.guardar_datos_inscripcion(uuid,jsonb,text,text)') is null
   or not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='solicitud_documentos' and column_name='sha256') then
  raise exception '048 requiere 042–047 completas';end if;
end $$;
-- Una sola escritura por intento: bloquea la solicitud, compara nivel y marca de datos
-- (CAS) con los que usó el backend para validar el archivo y devuelve la ruta anterior
-- para que el backend la retire después de confirmar. Los legacy no se tocan.
create or replace function public.guardar_certificado_inscripcion(
  p_id uuid,p_nivel text,p_marca timestamptz,p_subtipo text,p_ruta text,p_mime text,
  p_tamano integer,p_sha256 text,p_version_aviso text,p_version_terminos text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;d public.solicitud_documentos;v_ant text;v_id uuid;v_at timestamptz;
begin
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found then raise exception 'No existe solicitud' using errcode='SI404';end if;
 if not s.correo_verificado then raise exception 'Correo no verificado' using errcode='SI401';end if;
 if s.estado not in ('borrador','devuelta') then raise exception 'Solicitud no editable' using errcode='SI409';end if;
 perform 1 from public.solicitud_consentimientos where solicitud_id=p_id
  and version_aviso=p_version_aviso and version_terminos=p_version_terminos
  and acepto_tratamiento and declara_veracidad and acepto_terminos for share;
 if not found then raise exception 'Consentimiento no vigente' using errcode='SI403';end if;
 if s.datos_actualizados_at is null or s.nivel_estudios is null then
  raise exception 'Datos incompletos' using errcode='SI422';end if;
 if s.nivel_estudios is distinct from p_nivel or s.datos_actualizados_at is distinct from p_marca then
  raise exception 'Los datos cambiaron durante la subida' using errcode='SI433';end if;
 if not (case s.nivel_estudios
   when 'bachiller_reciente' then p_subtipo in ('acta_grado','copia_titulo')
   when 'bachiller_exterior' then p_subtipo='resolucion_homologacion'
   when 'decimo_aprobado' then p_subtipo='certificado_promocion'
   when 'cursando_bachillerato' then p_subtipo='certificado_estudios'
   else false end) then
  raise exception 'El nivel no admite este certificado' using errcode='SI434';end if;
 if p_mime not in ('image/jpeg','application/pdf') or p_tamano is null or p_tamano not between 1 and 2097152
  or coalesce(p_sha256,'')!~'^[a-f0-9]{64}$' or coalesce(p_ruta,'')!~
   ('^solicitudes/'||p_id::text||'/estudios/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|pdf)$')
  or (p_mime='image/jpeg')<>(p_ruta like '%.jpg') then
  raise exception 'Archivo inválido' using errcode='22023';end if;
 v_at:=clock_timestamp();
 select * into d from public.solicitud_documentos where solicitud_id=p_id
  and tipo_documento='certificado_estudios' for update;
 if found then
  v_ant:=d.storage_path;v_id:=d.id;
  update public.solicitud_documentos set subtipo=p_subtipo,storage_path=p_ruta,mime_type=p_mime,
   size_bytes=p_tamano,sha256=p_sha256,estado='recibido',motivo_rechazo=null,uploaded_at=v_at,
   reviewed_at=null,reviewed_by=null,archivo_verificado_at=null,archivo_eliminado_at=null where id=v_id;
 else
  insert into public.solicitud_documentos(solicitud_id,tipo_documento,subtipo,storage_path,mime_type,
   size_bytes,sha256,uploaded_at) values(p_id,'certificado_estudios',p_subtipo,p_ruta,p_mime,
   p_tamano,p_sha256,v_at) returning id into v_id;
 end if;
 update public.solicitudes_inscripcion set documento_estudios_pendiente_por_cupo=false where id=p_id;
 insert into public.solicitud_auditoria(solicitud_id,accion) values(p_id,'certificado_estudios_subido');
 return jsonb_build_object('id',v_id,'subtipo',p_subtipo,'mimeType',p_mime,'tamano',p_tamano,
  'subidoAt',v_at,'rutaAnterior',v_ant);
end $$;
revoke all on function public.guardar_certificado_inscripcion(uuid,text,timestamptz,text,text,text,integer,text,text,text)
 from public,anon,authenticated;
grant execute on function public.guardar_certificado_inscripcion(uuid,text,timestamptz,text,text,text,integer,text,text,text)
 to service_role;
notify pgrst,'reload schema';
commit;
