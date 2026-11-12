-- L10. Identificación por tipo y número en las tablas existentes. Sin identidades inventadas.
begin;
set local lock_timeout='5s';
-- GUARDA-MD5 INICIO (hash congelado de la instalación local; md5(replace(prosrc,chr(13),'')))
do $guard$declare g record;begin
 for g in select * from (values
  ('public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamp with time zone[],uuid,jsonb,jsonb)','aa1e88f45ef7afd43c167de9f2d46a67'),
  ('public.enviar_solicitud_inscripcion(uuid,text,text,text)','cc6d506c0eb22af1d579e37369026618'),
  ('public.guardar_datos_inscripcion(uuid,jsonb,text,text)','c23429eae2e4f50488d43fc74046485e'),
  ('public.legacy079_finalizar_aprobacion_inscripcion(uuid,uuid,timestamp with time zone,uuid,uuid,text,numeric)','60f35dec8eea6de946e62f2a13bc6f7e'),
  ('public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)','f39b3a7c2edb5cd76cf188d314f99e3d'),
  ('public.listar_solicitudes_admin(text,text,integer,integer)','49b574075fbeb4b3da9f71409144d3c3'),
  ('public.validar_aprobacion_inscripcion(uuid,uuid,uuid,text,text)','caaeb20071166ed56a1f9ff14c0f482e')
 ) v(sig,h) loop
  if to_regprocedure(g.sig) is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(g.sig)) is distinct from g.h then
   raise exception 'GUARDA_080: % no coincide con el cuerpo esperado; no se aplica la migración',g.sig;
  end if;
 end loop;
end $guard$;
-- GUARDA-MD5 FIN
alter table public.users add column if not exists identity_document_type text not null default 'cedula',add column if not exists identity_document_number text;
alter table public.solicitudes_inscripcion add column if not exists identity_document_type text not null default 'cedula',add column if not exists identity_document_number text;
alter table public.solicitud_consentimientos add column if not exists representante_document_type text not null default 'cedula',add column if not exists representante_document_number text;
do $$declare r record;begin for r in select conname from pg_constraint where conrelid='public.solicitud_consentimientos'::regclass and contype='c' and pg_get_constraintdef(oid) like '%representante_acepta%' and pg_get_constraintdef(oid) like '%representante_cedula%' loop execute format('alter table public.solicitud_consentimientos drop constraint %I',r.conname);end loop;end $$;
alter table public.solicitud_consentimientos drop constraint if exists guardian_document_shape;
alter table public.solicitud_consentimientos add constraint guardian_document_shape check(representante_document_type in('cedula','pasaporte','otro') and(not representante_acepta or(nullif(btrim(representante_nombre),'') is not null and coalesce(representante_document_number,representante_cedula) is not null)));
-- Procedencia sin copiar números ni nombres a auditoría.
insert into public.enrollment_domain_audit(action,entity_type,entity_id,new_value,reason)
 select 'identity_backfill_080','user',id::text,jsonb_build_object('source','legacy_cedula'),'080: copia literal del documento existente' from public.users where identity_document_number is null and cedula is not null;
update public.users set identity_document_number=cedula where identity_document_number is null and cedula is not null;
insert into public.enrollment_domain_audit(action,entity_type,entity_id,new_value,reason)
 select 'identity_backfill_080','request',id::text,jsonb_build_object('source','legacy_cedula'),'080: copia literal del documento existente' from public.solicitudes_inscripcion where identity_document_number is null and cedula is not null;
update public.solicitudes_inscripcion set identity_document_number=cedula where identity_document_number is null and cedula is not null;
alter table public.users alter column cedula drop not null;
alter table public.users alter column identity_document_number set not null;
alter table public.users drop constraint if exists users_document_type;
alter table public.users add constraint users_document_type check(identity_document_type in('cedula','pasaporte','otro'));
alter table public.solicitudes_inscripcion drop constraint if exists requests_document_type;
alter table public.solicitudes_inscripcion add constraint requests_document_type check(identity_document_type in('cedula','pasaporte','otro'));
create unique index if not exists users_identity_document_unique on public.users(identity_document_type,identity_document_number);
create unique index if not exists requests_identity_document_active_unique on public.solicitudes_inscripcion(identity_document_type,identity_document_number) where identity_document_number is not null and estado in('enviada','devuelta','aprobada','archivada');
-- El índice legacy de cédula queda como defensa para ese tipo; pasaporte/otro tienen cedula=NULL.
do $$declare definition text;begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.solicitudes_inscripcion'::regclass and conname='solicitudes_datos_finales_catalogos';
 if position('extranjero_sin_cedula' in definition)=0 then
  definition:=replace(definition,'''extranjero_con_cedula''::text','''extranjero_con_cedula''::text, ''extranjero_sin_cedula''::text');
  alter table public.solicitudes_inscripcion drop constraint solicitudes_datos_finales_catalogos;
  execute 'alter table public.solicitudes_inscripcion add constraint solicitudes_datos_finales_catalogos '||definition;
 end if;
end $$;
create or replace function private.identity_number_valid_v2(p_type text,p_number text) returns boolean language plpgsql immutable security invoker set search_path='' as $$declare total integer:=0;digit integer;i integer;province integer;begin
 if p_type is null or p_number is null then return false;end if;
 if p_type in('pasaporte','otro') then return p_number ~ '^[A-Z0-9][A-Z0-9-]{2,29}$';end if;
 if p_type<>'cedula' or p_number !~ '^[0-9]{10}$' then return false;end if;
 province:=left(p_number,2)::integer;if not(province between 1 and 24 or province=30) or substring(p_number,3,1)::integer>=6 then return false;end if;
 for i in 1..9 loop digit:=substring(p_number,i,1)::integer*case when i%2=1 then 2 else 1 end;if digit>9 then digit:=digit-9;end if;total:=total+digit;end loop;
 return (10-total%10)%10=right(p_number,1)::integer;
end $$;
create or replace function private.identity_document_guard_v2() returns trigger language plpgsql security invoker set search_path='' as $$declare changed boolean;begin
 if tg_op='UPDATE' and new.identity_document_type='cedula' and new.cedula is distinct from old.cedula and new.identity_document_number is not distinct from old.identity_document_number then new.identity_document_number:=new.cedula;end if;
 new.identity_document_type:=coalesce(new.identity_document_type,'cedula');
 if new.identity_document_type='cedula' then new.identity_document_number:=coalesce(new.identity_document_number,new.cedula);end if;
 new.identity_document_number:=upper(btrim(new.identity_document_number));
 changed:=tg_op='INSERT';if tg_op='UPDATE' then changed:=row(new.identity_document_type,new.identity_document_number) is distinct from row(old.identity_document_type,old.identity_document_number);end if;
 if new.identity_document_type not in('cedula','pasaporte','otro') then perform private.raise_cohort_error('DOCUMENTO_TIPO_INVALIDO');end if;
 if new.identity_document_type<>'cedula' and changed and not private.enrollment_rule_enabled('foreign_identity') then perform private.raise_cohort_error('DOCUMENTO_REGLAS_INACTIVAS');end if;
 if tg_table_name='solicitudes_inscripcion' then
  if tg_op='UPDATE' and changed and old.estado not in('borrador','devuelta') then perform private.raise_cohort_error('DOCUMENTO_ESTADO_NO_EDITABLE');end if;
  if new.identity_document_number is null and new.estado='borrador' then return new;end if;
 end if;
 if changed and private.enrollment_rule_enabled('foreign_identity') and not private.identity_number_valid_v2(new.identity_document_type,new.identity_document_number) then perform private.raise_cohort_error('DOCUMENTO_NUMERO_INVALIDO');end if;
 if new.identity_document_type='cedula' then new.cedula:=new.identity_document_number;else new.cedula:=null;end if;
 if new.identity_document_number is not null then
  perform pg_advisory_xact_lock(hashtextextended('identity_document:'||new.identity_document_type||':'||new.identity_document_number,0));
  if tg_table_name='users' and changed and exists(select 1 from public.users where id<>new.id and identity_document_type=new.identity_document_type and identity_document_number=new.identity_document_number) then perform private.raise_cohort_error('DOCUMENTO_DUPLICADO');end if;
  if tg_table_name='solicitudes_inscripcion' then if new.estado in('enviada','devuelta','aprobada','archivada') and exists(select 1 from public.solicitudes_inscripcion where id<>new.id and identity_document_type=new.identity_document_type and identity_document_number=new.identity_document_number and estado in('enviada','devuelta','aprobada','archivada')) then perform private.raise_cohort_error('DOCUMENTO_DUPLICADO');end if;end if;
 end if;return new;
end $$;
drop trigger if exists users_00_identity_document on public.users;
create trigger users_00_identity_document before insert or update on public.users for each row execute function private.identity_document_guard_v2();
drop trigger if exists solicitudes_00_identity_document on public.solicitudes_inscripcion;
create trigger solicitudes_00_identity_document before insert or update on public.solicitudes_inscripcion for each row execute function private.identity_document_guard_v2();
-- Respaldos para volver al comportamiento anterior con el indicador apagado.
do $$declare r record;begin for r in select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('guardar_datos_inscripcion','enviar_solicitud_inscripcion','validar_aprobacion_inscripcion','legacy079_finalizar_aprobacion_inscripcion','commit_manual_enrollment','list_admin_students','listar_solicitudes_admin') loop
 if not exists(select 1 from pg_proc b join pg_namespace bn on bn.oid=b.pronamespace where bn.nspname='public' and b.proname='legacy080_'||r.proname) then execute format('alter function public.%I(%s) rename to %I',r.proname,r.args,'legacy080_'||r.proname);end if;end loop;end $$;

create or replace function private.identity_save_request_v2(p_id uuid,p_datos jsonb,p_version_aviso text,p_version_terminos text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;c public.solicitud_consentimientos;
 v_min integer;v_edad integer;v_fecha date;v_hoy date;v_nivel text;v_rep jsonb;
 v_doc_type text:=coalesce(p_datos->>'documentType','cedula');v_doc_number text:=upper(btrim(coalesce(p_datos->>'documentNumber',p_datos->>'cedula')));
 v_cambio boolean;v_rep_cambio boolean;v_marca timestamptz;
begin
 if p_datos is null or jsonb_typeof(p_datos)<>'object' or exists(
  select 1 from jsonb_object_keys(p_datos) k where k not in
   ('documentType','documentNumber','nombres','apellidos','cedula','fechaNacimiento','telefono','nacionalidadTipo','tipoSangre','nivelEstudios','representante')) then
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
  or not private.identity_number_valid_v2(v_doc_type,v_doc_number)
  or coalesce(p_datos->>'fechaNacimiento','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p_datos->>'nacionalidadTipo','') not in ('ecuatoriana','extranjero_con_cedula','extranjero_sin_cedula')
  or coalesce(p_datos->>'tipoSangre','') not in ('A+','A-','B+','B-','AB+','AB-','O+','O-','no_sabe') then
  raise exception 'Datos incompletos' using errcode='SI422';end if;
 if coalesce(p_datos->>'telefono','') !~ '^(09[0-9]{8}|0[2-7][0-9]{7})$' then
  raise exception 'Teléfono obligatorio o inválido' using errcode='SI436';end if;
 v_fecha:=(p_datos->>'fechaNacimiento')::date;
 v_hoy:=(clock_timestamp() at time zone 'America/Guayaquil')::date;
 if v_fecha>v_hoy then raise exception 'Fecha inválida' using errcode='SI427';end if;
 v_edad:=extract(year from age(v_hoy,v_fecha))::integer;
 if v_edad<v_min then raise exception 'Edad inferior a mínimo de curso' using errcode='SI425';end if;
 if v_edad>100 then raise exception 'Edad superior al máximo' using errcode='SI426';end if;
 v_nivel:=case when p_datos ? 'nivelEstudios' then p_datos->>'nivelEstudios' else s.nivel_estudios end;
 if p_datos ? 'nivelEstudios' and (v_nivel is null or v_nivel not in
  ('bachiller','bachiller_reciente','bachiller_exterior','decimo_aprobado')) then
  raise exception 'Nivel no admitido' using errcode='SI437';end if;
 v_rep:=p_datos->'representante';
 if v_edad<18 then
  if v_rep is null or jsonb_typeof(v_rep)<>'object' or v_rep->'acepta' is distinct from 'true'::jsonb
   or nullif(v_rep->>'nombre','') is null or not private.identity_number_valid_v2(coalesce(v_rep->>'documentType','cedula'),upper(btrim(coalesce(v_rep->>'documentNumber',v_rep->>'cedula'))))
   or (coalesce(v_rep->>'documentType','cedula')=v_doc_type and upper(btrim(coalesce(v_rep->>'documentNumber',v_rep->>'cedula')))=v_doc_number) then
   raise exception 'Representante requerido' using errcode='SI423';end if;
 elsif v_rep is not null then raise exception 'Representante no aplica' using errcode='SI432';end if;
 -- F13/F15 comparten esta clave al enviar/aprobar; borradores no reservan cédula.
 perform pg_advisory_xact_lock(hashtextextended('identity_document:'||v_doc_type||':'||v_doc_number,0));
 if exists(select 1 from public.users where identity_document_type=v_doc_type and identity_document_number=v_doc_number) or exists(
  select 1 from public.solicitudes_inscripcion where id<>p_id and identity_document_type=v_doc_type and identity_document_number=v_doc_number
   and estado in ('enviada','devuelta','aprobada','archivada')) then
  raise exception 'Datos no registrables' using errcode='SI429';end if;
 v_rep_cambio:=row(c.representante_document_type,coalesce(c.representante_document_number,c.representante_cedula)) is distinct from row(coalesce(v_rep->>'documentType','cedula'),upper(btrim(coalesce(v_rep->>'documentNumber',v_rep->>'cedula')))) or row(c.representante_nombre,c.representante_cedula,c.representante_acepta)
  is distinct from row(v_rep->>'nombre',v_rep->>'cedula',v_edad<18);
 v_cambio:=v_rep_cambio or row(s.identity_document_type,s.identity_document_number) is distinct from row(v_doc_type,v_doc_number) or row(s.nombres,s.apellidos,s.cedula,s.fecha_nacimiento,s.telefono,
  s.nacionalidad_tipo,s.tipo_sangre,s.nivel_estudios) is distinct from
  row(p_datos->>'nombres',p_datos->>'apellidos',p_datos->>'cedula',v_fecha,p_datos->>'telefono',
   p_datos->>'nacionalidadTipo',p_datos->>'tipoSangre',v_nivel)
  or s.solicitada_at is null or s.datos_actualizados_at is null;
 if v_cambio then
  v_marca:=clock_timestamp();
  update public.solicitudes_inscripcion set nombres=p_datos->>'nombres',apellidos=p_datos->>'apellidos',
   identity_document_type=v_doc_type,identity_document_number=v_doc_number,cedula=case when v_doc_type='cedula' then v_doc_number else null end,fecha_nacimiento=v_fecha,telefono=p_datos->>'telefono',
   nacionalidad_tipo=p_datos->>'nacionalidadTipo',tipo_sangre=p_datos->>'tipoSangre',nivel_estudios=v_nivel,
   documento_estudios_pendiente_por_cupo=case when s.nivel_estudios is distinct from v_nivel then false
    else documento_estudios_pendiente_por_cupo end,
   solicitada_at=coalesce(solicitada_at,v_marca),datos_actualizados_at=v_marca where id=p_id;
  update public.solicitud_consentimientos set representante_nombre=v_rep->>'nombre',
   representante_document_type=coalesce(v_rep->>'documentType','cedula'),representante_document_number=upper(btrim(coalesce(v_rep->>'documentNumber',v_rep->>'cedula'))),
   representante_cedula=case when coalesce(v_rep->>'documentType','cedula')='cedula' then coalesce(v_rep->>'documentNumber',v_rep->>'cedula') else null end,representante_acepta=v_edad<18,
   representante_autoriza_tratamiento=representante_autoriza_tratamiento or v_edad<18 where id=c.id;
  insert into public.solicitud_auditoria(solicitud_id,accion) values(p_id,'datos_actualizados');
 else v_marca:=s.datos_actualizados_at;
 end if;
 return jsonb_build_object('id',p_id,'datosActualizadosAt',v_marca);
end $$;
create or replace function private.identity_enviar_solicitud_inscripcion_v2(
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
 if s.nombres is null or s.apellidos is null or s.identity_document_number is null or s.fecha_nacimiento is null
  or s.tipo_sangre is null or s.nivel_estudios is null or s.solicitada_at is null
  or s.datos_actualizados_at is null
  or coalesce(s.nacionalidad_tipo,'') not in ('ecuatoriana','extranjero_con_cedula','extranjero_sin_cedula')
  then raise exception 'Datos incompletos' using errcode='SI422';end if;
 if coalesce(s.telefono,'') !~ '^(09[0-9]{8}|0[2-7][0-9]{7})$' then
  raise exception 'Teléfono obligatorio o inválido' using errcode='SI436';end if;
 if s.nivel_estudios not in ('bachiller','bachiller_reciente','bachiller_exterior','decimo_aprobado') then
  raise exception 'Nivel no admitido' using errcode='SI437';end if;
 select edad_minima into v_min from public.courses where id=s.course_id for share;
 if not found then raise exception 'Curso no disponible' using errcode='SI428';end if;
 v_hoy:=(clock_timestamp() at time zone 'America/Guayaquil')::date;
 v_edad:=extract(year from age(v_hoy,s.fecha_nacimiento))::integer;
 if v_edad<v_min then raise exception 'Edad inferior al mínimo' using errcode='SI425';end if;
 if v_edad>100 then raise exception 'Edad superior al máximo' using errcode='SI426';end if;
 if v_edad<18 and (not c.representante_acepta or not c.representante_autoriza_tratamiento
  or c.representante_nombre is null or coalesce(c.representante_document_number,c.representante_cedula) is null or (c.representante_document_type=s.identity_document_type and coalesce(c.representante_document_number,c.representante_cedula)=s.identity_document_number)) then
  raise exception 'Representante requerido' using errcode='SI423';end if;
 -- Misma clave que el guardado de datos y la aprobación: serializa la cédula.
 perform pg_advisory_xact_lock(hashtextextended('identity_document:'||s.identity_document_type||':'||s.identity_document_number,0));
 if exists(select 1 from public.users where identity_document_type=s.identity_document_type and identity_document_number=s.identity_document_number) or exists(
  select 1 from public.solicitudes_inscripcion where id<>p_id and identity_document_type=s.identity_document_type and identity_document_number=s.identity_document_number
   and estado in ('enviada','devuelta','aprobada','archivada')) then
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
create or replace function private.identity_validar_aprobacion_inscripcion_v2(
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
 if s.nombres is null or s.apellidos is null or s.identity_document_number is null or s.fecha_nacimiento is null
  or s.tipo_sangre is null or s.nivel_estudios is null or s.solicitada_at is null
  or s.datos_actualizados_at is null
  or coalesce(s.nacionalidad_tipo,'') not in ('ecuatoriana','extranjero_con_cedula','extranjero_sin_cedula') then
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
  or c.representante_nombre is null or coalesce(c.representante_document_number,c.representante_cedula) is null or (c.representante_document_type=s.identity_document_type and coalesce(c.representante_document_number,c.representante_cedula)=s.identity_document_number)) then
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
 perform pg_advisory_xact_lock(hashtextextended('identity_document:'||s.identity_document_type||':'||s.identity_document_number,0));
 if exists(select 1 from public.users where identity_document_type=s.identity_document_type and identity_document_number=s.identity_document_number) or exists(
  select 1 from public.solicitudes_inscripcion where id<>p_id and identity_document_type=s.identity_document_type and identity_document_number=s.identity_document_number
   and estado in ('enviada','devuelta','aprobada','archivada')) then
  raise exception 'Cédula ya registrada' using errcode='SI460';end if;
end $$;
create or replace function private.identity_finalize_legacy_v2(
  p_id uuid,p_actor uuid,p_claim timestamptz,p_student uuid,p_cohort uuid,p_estado text,p_monto numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;v_enrollment uuid;
begin
 if p_estado is distinct from 'pendiente_cohorte' or p_cohort is not null or p_monto is not null then
  raise exception 'Aprobar no asigna cohorte ni monto; requiere backend I02' using errcode='IE409';end if;
 select * into s from public.solicitudes_inscripcion where id=p_id and estado='enviada'
  and reviewed_by=p_actor and reviewed_at=p_claim for update;
 if not found then raise exception 'La solicitud está cerrada o en resolución' using errcode='SI409';end if;
 insert into public.users(id,cedula,nombre_completo,telefono,fecha_nacimiento,rol,status,debe_cambiar_password,
  tipo_sangre,ciudadania,identity_document_type,identity_document_number)
 values(p_student,s.cedula,s.nombre_completo,s.telefono,s.fecha_nacimiento,'estudiante','verificado',false,
  case when s.tipo_sangre='no_sabe' then null else s.tipo_sangre end,
  case s.nacionalidad_tipo when 'ecuatoriana' then 'Ecuatoriana' else 'Extranjera' end,s.identity_document_type,s.identity_document_number);
 insert into public.enrollments(student_id,course_id,cohort_id,status,monto_total,origen,requisitos_verificados_at,etapa_inscripcion)
 values(p_student,s.course_id,p_cohort,p_estado::public.enrollment_status,p_monto,'solicitud',clock_timestamp(),'por_agendar')
 returning id into v_enrollment;
 -- El trigger de matrícula crea las cuatro filas del checklist; el original del certificado solo aplica
 -- si el postulante presentó uno.
 if not exists(select 1 from public.solicitud_documentos where solicitud_id=p_id and tipo_documento='certificado_estudios') then
  update public.enrollment_documents set estado='no_aplica' where enrollment_id=v_enrollment and tipo='titulo_bachiller';
 end if;
 update public.solicitudes_inscripcion set estado='aprobada',student_id=p_student,motivo_rechazo=null where id=p_id;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(p_id,p_actor,'solicitud_aprobada');
 return jsonb_build_object('studentId',p_student,'enrollmentId',v_enrollment,'etapa','por_agendar');
end $$;
create or replace function private.identity_commit_manual_v2(
  p_id uuid, p_worker uuid, p_student uuid, p_profile jsonb, p_course uuid,
  p_cohort uuid, p_plan jsonb, p_scheduled_ats timestamptz[], p_instructor uuid,
  p_documents jsonb, p_payment jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare op public.manual_enrollment_operations; c public.cohorts;
  e public.enrollments; v_type public.course_type; v_slots integer := 0;
  v_response jsonb; v_discount numeric; v_paid numeric; v_net numeric;
  v_birth date; v_senior boolean; v_doc jsonb; v_seen jsonb := '{}'::jsonb;
  v_document_type text; v_status text; v_pending integer;
begin
  select * into op from public.manual_enrollment_operations where id=p_id for update;
  if not found or op.phase <> 'processing' or op.worker_id <> p_worker then
    raise exception 'Operación no reservada por este proceso' using errcode='CD021';
  end if;
  if not exists(select 1 from public.users where id=op.actor_id and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  select tipo into strict v_type from public.courses where id=p_course;
  if p_cohort is not null then
    select * into strict c from public.cohorts where id=p_cohort for update;
    if c.course_id <> p_course then raise exception 'Cohorte de otro curso' using errcode='CD020'; end if;
    if (clock_timestamp() at time zone 'America/Guayaquil')::date
      not between c.fecha_inicio_matricula and c.fecha_fin_matricula then
      raise exception 'La matrícula de la cohorte ya no está abierta' using errcode='CD020';
    end if;
  elsif cardinality(p_scheduled_ats)>0 then
    raise exception 'Una matrícula pendiente no puede generar franjas' using errcode='CD020';
  end if;

  if p_payment is null or jsonb_typeof(p_payment) <> 'object'
     or p_payment->>'modalidad' is null or p_payment->>'modalidad' not in ('abono','completo')
     or p_payment->>'descuento' is null or p_payment->>'montoAbonado' is null then
    raise exception 'Pago inicial inválido' using errcode='CD025';
  end if;
  v_discount := (p_payment->>'descuento')::numeric;
  v_paid := (p_payment->>'montoAbonado')::numeric;
  if v_discount < 0 or v_paid < 0 or scale(v_discount)>2 or scale(v_paid)>2 then
    raise exception 'Los montos deben ser no negativos y tener hasta dos decimales' using errcode='CD025';
  end if;
  if p_cohort is null then
    if v_discount <> 0 or p_payment->>'modalidad' <> 'abono' then
      raise exception 'Sin cohorte solo se permite abono y descuento cero' using errcode='CD025';
    end if;
    v_net := null;
  else
    if v_discount > c.precio then
      raise exception 'El descuento supera el precio de la cohorte' using errcode='CD025';
    end if;
    v_net := c.precio - v_discount;
    if v_paid > v_net or
      (p_payment->>'modalidad' = 'completo' and v_paid <> v_net) or
      (p_payment->>'modalidad' = 'abono' and v_paid = v_net and v_net > 0) then
      raise exception 'El abono no corresponde al monto total neto' using errcode='CD025';
    end if;
  end if;
  if p_documents is null or jsonb_typeof(p_documents) <> 'array'
     or jsonb_array_length(p_documents) <> 4 then
    raise exception 'Se requieren los cuatro documentos' using errcode='CD026';
  end if;

  if p_profile is not null then
    if op.student_id is distinct from p_student or not op.student_created then
      raise exception 'Cuenta nueva no registrada en la operación' using errcode='CD021';
    end if;
    insert into public.users(id,cedula,nombre_completo,telefono,rol,debe_cambiar_password,fecha_nacimiento,identity_document_type,identity_document_number)
    values(p_student,p_profile->>'cedula',p_profile->>'nombreCompleto',nullif(p_profile->>'telefono',''),
      'estudiante',true,(p_profile->>'fechaNacimiento')::date,coalesce(p_profile->>'documentType','cedula'),coalesce(p_profile->>'documentNumber',p_profile->>'cedula'));
  elsif op.student_created then
    raise exception 'Falta perfil de la cuenta nueva' using errcode='CD021';
  end if;
  select fecha_nacimiento into v_birth from public.users where id=p_student;
  v_senior := v_birth is not null and
    date_part('year', age((clock_timestamp() at time zone 'America/Guayaquil')::date, v_birth)) >= 65;

  insert into public.enrollments(student_id,course_id,course_type,cohort_id,status,
    monto_total,descuento,monto_abonado,practice_plan)
    values(p_student,p_course,v_type,p_cohort,
      case when p_cohort is null then 'pendiente_cohorte'::public.enrollment_status
        else 'activo'::public.enrollment_status end,
      v_net,v_discount,v_paid,p_plan) returning * into e;
  for v_doc in select value from jsonb_array_elements(p_documents) loop
    v_document_type := v_doc->>'tipo';
    v_status := v_doc->>'estado';
    if v_document_type is null or v_document_type not in
      ('cedula','papeleta_votacion','tipo_sangre','titulo_bachiller')
      or v_status is null or v_status not in ('entregado','pendiente','no_aplica')
      or v_seen ? v_document_type then
      raise exception 'Checklist inválido o repetido' using errcode='CD026';
    end if;
    v_seen := v_seen || pg_catalog.jsonb_build_object(v_document_type,true);
    if v_senior and v_document_type = 'papeleta_votacion' then v_status := 'no_aplica'; end if;
    update public.enrollment_documents set estado=v_status,
      fecha_marcado=case when v_status <> 'pendiente' and not (v_senior and v_document_type='papeleta_votacion')
        then clock_timestamp() else null end,
      marcado_por=case when v_status <> 'pendiente' and not (v_senior and v_document_type='papeleta_votacion')
        then op.actor_id else null end
    where enrollment_id=e.id and tipo=v_document_type;
    if not found then raise exception 'Checklist incompleto' using errcode='CD026'; end if;
  end loop;
  if cardinality(p_scheduled_ats)>0 then
    insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status)
      select p_cohort,p_instructor,p_student,t,60,'asignado' from unnest(p_scheduled_ats) t;
    get diagnostics v_slots = row_count;
  end if;
  select count(*) into v_pending from public.enrollment_documents
    where enrollment_id=e.id and estado='pendiente';
  v_response := jsonb_build_object('operationId',p_id,'studentId',p_student,'studentCreated',op.student_created,
    'enrollmentId',e.id,'courseId',p_course,'courseType',v_type,'cohortId',p_cohort,'status',e.status,
    'slotsCreated',v_slots,'plan',p_plan,'montoTotal',v_net,'descuento',v_discount,
    'montoAbonado',v_paid,'saldo',case when v_net is null then null else v_net-v_paid end,
    'documentosPendientes',v_pending);
  update public.manual_enrollment_operations set phase='committed',response=v_response,
    student_id=p_student,updated_at=now() where id=p_id;
  return v_response;
end $$;

create or replace function public.guardar_datos_inscripcion(p_id uuid,p_datos jsonb,p_version_aviso text,p_version_terminos text) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('foreign_identity') then return private.identity_save_request_v2(p_id,p_datos,p_version_aviso,p_version_terminos);end if;
 return public.legacy080_guardar_datos_inscripcion(p_id,p_datos,p_version_aviso,p_version_terminos);end $$;
create or replace function public.enviar_solicitud_inscripcion(p_id uuid,p_modo text,p_version_aviso text,p_version_terminos text) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('foreign_identity') then return private.identity_enviar_solicitud_inscripcion_v2(p_id,p_modo,p_version_aviso,p_version_terminos);end if;
 return public.legacy080_enviar_solicitud_inscripcion(p_id,p_modo,p_version_aviso,p_version_terminos);end $$;
create or replace function public.validar_aprobacion_inscripcion(p_id uuid,p_verif_identidad uuid,p_verif_estudios uuid,p_version_aviso text,p_version_terminos text) returns void language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('foreign_identity') then perform private.identity_validar_aprobacion_inscripcion_v2(p_id,p_verif_identidad,p_verif_estudios,p_version_aviso,p_version_terminos);return;end if;
 perform public.legacy080_validar_aprobacion_inscripcion(p_id,p_verif_identidad,p_verif_estudios,p_version_aviso,p_version_terminos);end $$;
create or replace function public.legacy079_finalizar_aprobacion_inscripcion(p_id uuid,p_actor uuid,p_claim timestamptz,p_student uuid,p_cohort uuid,p_estado text,p_monto numeric) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('foreign_identity') then return private.identity_finalize_legacy_v2(p_id,p_actor,p_claim,p_student,p_cohort,p_estado,p_monto);end if;
 return public.legacy080_legacy079_finalizar_aprobacion_inscripcion(p_id,p_actor,p_claim,p_student,p_cohort,p_estado,p_monto);end $$;
create or replace function public.commit_manual_enrollment(p_id uuid,p_worker uuid,p_student uuid,p_profile jsonb,p_course uuid,p_cohort uuid,p_plan jsonb,p_scheduled_ats timestamptz[],p_instructor uuid,p_documents jsonb,p_payment jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('foreign_identity') then return private.identity_commit_manual_v2(p_id,p_worker,p_student,p_profile,p_course,p_cohort,p_plan,p_scheduled_ats,p_instructor,p_documents,p_payment);end if;
 return public.legacy080_commit_manual_enrollment(p_id,p_worker,p_student,p_profile,p_course,p_cohort,p_plan,p_scheduled_ats,p_instructor,p_documents,p_payment);end $$;
create or replace function public.identity_documents_v2(p_actor uuid,p_students uuid[]) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin
 if not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then perform private.raise_cohort_error('PERMISO_REQUERIDO');end if;
 return coalesce((select jsonb_object_agg(id::text,jsonb_build_object('type',identity_document_type,'number',identity_document_number)) from public.users where id=any(p_students) and rol='estudiante'),'{}'::jsonb);end $$;
create or replace function public.find_manual_students_v2(p_actor uuid,p_query text) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin
 if not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then perform private.raise_cohort_error('PERMISO_REQUERIDO');end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'cedula',u.cedula,'nombre_completo',u.nombre_completo,'correo',a.email,'documentType',u.identity_document_type,'documentNumber',u.identity_document_number) order by u.id) from public.users u join auth.users a on a.id=u.id where u.rol='estudiante' and(u.identity_document_number=upper(btrim(p_query)) or lower(a.email)=lower(btrim(p_query)))),'[]'::jsonb);end $$;
-- Búsqueda tipada antes de paginar; conserva escape, orden y filtros existentes.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.legacy080_list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'::regprocedure);
 definition:=replace(definition,'legacy080_list_admin_students','list_admin_students');
 if position('position(v_q in public.student_search_key(u.cedula))>0' in definition)=0 then raise exception 'Búsqueda de Alumnos distinta de la revisada';end if;
 definition:=replace(definition,'position(v_q in public.student_search_key(u.cedula))>0','position(v_q in public.student_search_key(u.cedula))>0 or (private.enrollment_rule_enabled(''foreign_identity'') and position(v_q in public.student_search_key(u.identity_document_number))>0)');execute definition;
 definition:=pg_get_functiondef('public.legacy080_listar_solicitudes_admin(text,text,integer,integer)'::regprocedure);definition:=replace(definition,'legacy080_listar_solicitudes_admin','listar_solicitudes_admin');
 definition:=replace(definition,'s.cedula ilike v_like','coalesce(s.cedula,(select doc.identity_document_number from public.solicitudes_inscripcion doc where doc.id=s.id)) ilike v_like');
 definition:=replace(definition,'''cedula'',t.cedula,','''cedula'',t.cedula,''documentType'',(select doc.identity_document_type from public.solicitudes_inscripcion doc where doc.id=t.id),''documentNumber'',(select doc.identity_document_number from public.solicitudes_inscripcion doc where doc.id=t.id),');execute definition;
end $$;
-- Solo backend de confianza; nunca aceptar actor del cuerpo de un alumno.
do $$declare r record;begin for r in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='private' and p.proname like 'identity_%') or(n.nspname='public' and(p.proname like 'legacy080_%' or p.proname in('guardar_datos_inscripcion','enviar_solicitud_inscripcion','validar_aprobacion_inscripcion','legacy079_finalizar_aprobacion_inscripcion','commit_manual_enrollment','list_admin_students','listar_solicitudes_admin','identity_documents_v2','find_manual_students_v2'))) loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',r.nspname,r.proname,r.args);execute format('grant execute on function %I.%I(%s) to service_role',r.nspname,r.proname,r.args);end loop;end $$;
update public.enrollment_rule_flags set implemented=true,enabled=false where key='foreign_identity';
notify pgrst,'reload schema';
commit;
