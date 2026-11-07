-- F09. MANUAL, después de 044. Emisión y consumo de OTP serializados por correo canónico.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.crear_borrador_limitado(text,uuid,text,timestamptz,jsonb)') is null
   or to_regclass('public.correo_bloqueado') is null then raise exception '045 requiere 042–044 completas';end if;
end $$;

create or replace function public.correo_tiene_cuenta(p_correo text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where public.normalizar_correo_inscripcion(email)=public.normalizar_correo_inscripcion(p_correo))
$$;
revoke all on function public.correo_tiene_cuenta(text) from public,anon,authenticated;
grant execute on function public.correo_tiene_cuenta(text) to service_role;

create or replace function public.emitir_codigo_inscripcion(p_correo text,p_curso uuid,p_codigo_hash text,p_expira timestamptz,p_correo_hash text,p_topes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;v_new jsonb;v_existe boolean;
begin
 if p_codigo_hash is null or p_codigo_hash!~'^[a-f0-9]{64}$' or p_correo_hash is null or p_correo_hash!~'^[a-f0-9]{64}$'
   or p_expira is null or p_expira<=clock_timestamp() then raise exception 'Código inválido' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('solicitud:'||public.normalizar_correo_inscripcion(p_correo),0));
 select * into s from public.solicitudes_inscripcion where correo_normalizado=public.normalizar_correo_inscripcion(p_correo) for update;
 v_existe:=found;
 if exists(select 1 from public.correo_bloqueado where correo_hash=p_correo_hash and hasta>clock_timestamp()) then
   return jsonb_build_object('emitir',false);end if;
 if not v_existe then
   if public.correo_tiene_cuenta(p_correo) then return jsonb_build_object('emitir',false);end if;
   if not exists(select 1 from public.courses where id=p_curso) then return jsonb_build_object('emitir',false);end if;
   v_new:=public.crear_borrador_limitado(p_correo,p_curso,p_codigo_hash,p_expira,p_topes);
   if v_new->>'motivo' is not null then return v_new||jsonb_build_object('emitir',false);end if;
   select * into s from public.solicitudes_inscripcion where id=(v_new->>'id')::uuid for update;
 end if;
 -- Nunca reabrir/reemplazar solicitud ni reescribir correo/curso/fechas personales.
 update public.solicitudes_inscripcion set codigo_verificacion=p_codigo_hash,codigo_expira_at=p_expira,intentos_codigo=0 where id=s.id;
 return jsonb_build_object('emitir',true,'correo',s.correo,'id',s.id);
end $$;
revoke all on function public.emitir_codigo_inscripcion(text,uuid,text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.emitir_codigo_inscripcion(text,uuid,text,timestamptz,text,jsonb) to service_role;

create or replace function public.confirmar_codigo_inscripcion(p_correo text,p_codigo_hash text,p_correo_hash text,p_topes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;v_existe boolean;v_ahora timestamptz;v_inicio timestamptz;
 v_fallos integer;v_tope integer;v_reserva jsonb;
begin
 if p_codigo_hash is null or p_codigo_hash!~'^[a-f0-9]{64}$' or p_correo_hash is null or p_correo_hash!~'^[a-f0-9]{64}$' then
   raise exception 'Código inválido' using errcode='22023';end if;
 v_tope:=(p_topes->>'fallosCorreoDia')::integer;
 if v_tope is null or v_tope<0 or v_tope>1000000 then raise exception 'Tope inválido' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('solicitud:'||public.normalizar_correo_inscripcion(p_correo),0));
 perform pg_advisory_xact_lock(hashtextextended('intento_codigo:'||p_correo_hash,0));
 select * into s from public.solicitudes_inscripcion where correo_normalizado=public.normalizar_correo_inscripcion(p_correo) for update;
 v_existe:=found;v_ahora:=clock_timestamp();
 v_inicio:=date_trunc('day',v_ahora at time zone 'America/Guayaquil') at time zone 'America/Guayaquil';
 select count(*) into v_fallos from public.enrollment_rate_events where tipo='intento_codigo' and clave_hash=p_correo_hash and created_at>=v_inicio;
 if v_fallos>=v_tope then return jsonb_build_object('resultado','limite');end if;
 if v_existe and s.codigo_verificacion=p_codigo_hash and s.codigo_expira_at>v_ahora and not exists(
   select 1 from public.correo_bloqueado where correo_hash=p_correo_hash and hasta>v_ahora) then
   update public.solicitudes_inscripcion set correo_verificado=true,codigo_verificacion=null,codigo_expira_at=null,intentos_codigo=0 where id=s.id;
   insert into public.solicitud_auditoria(solicitud_id,accion) values(s.id,'correo_verificado');
   return jsonb_build_object('resultado','valido','id',s.id,'scope',case when s.estado in ('borrador','devuelta') then 'edicion' else 'estado' end);
 end if;
 -- Cuenta cada petición fallida UNA vez, también desconocido/vencido; no depende de reintentos CAS.
 v_reserva:=public.reservar_limite_inscripcion('fallo_codigo',null,p_correo_hash,p_topes);
 if not (v_reserva->>'permitido')::boolean then return jsonb_build_object('resultado','limite');end if;
 if v_existe then
   update public.solicitudes_inscripcion set intentos_codigo=intentos_codigo+1,
     codigo_verificacion=case when v_fallos+1>=v_tope then null else codigo_verificacion end,
     codigo_expira_at=case when v_fallos+1>=v_tope then null else codigo_expira_at end where id=s.id;
 end if;
 return jsonb_build_object('resultado',case when v_fallos+1>=v_tope then 'limite' else 'invalido' end);
end $$;
revoke all on function public.confirmar_codigo_inscripcion(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirmar_codigo_inscripcion(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
