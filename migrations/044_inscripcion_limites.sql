-- F07. Aplicación MANUAL después de 043. Sin acceso directo de clientes.
begin;
set local lock_timeout='5s';
do $$ begin
  if to_regprocedure('public.consumir_cupo_inscripcion(text,integer)') is null
    or to_regclass('public.app_settings') is null or to_regclass('public.enrollment_rate_events') is null
    or to_regclass('public.inscripcion_endurecimiento_respaldo') is null then
    raise exception '044 requiere 042 y 043 completas';
  end if;
end $$;

create or replace function public.reservar_limite_inscripcion(
  p_operacion text,p_ip_hash text,p_correo_hash text,p_topes jsonb,p_solicitud uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_dia timestamptz;v_tipo text;v_hash text;
  v_tope integer;v_usado integer;v_ultimo timestamptz;v_global text;v_global_tope integer;
  v_permitido boolean:=true;s public.solicitudes_inscripcion;
begin
  if p_operacion is null or p_operacion not in ('codigo_ip','codigo','solicitud','subida','fallo_codigo')
    or p_topes is null or jsonb_typeof(p_topes)<>'object' then raise exception 'Operación inválida' using errcode='22023';end if;
  if p_operacion in ('codigo_ip','codigo','solicitud') then
    perform 1 from public.app_settings where id and inscripciones_abiertas for share;
    if not found then return jsonb_build_object('permitido',false,'motivo','cerradas');end if;
  end if;
  v_dia:=date_trunc('day',v_now at time zone 'America/Guayaquil') at time zone 'America/Guayaquil';
  v_tipo:=case p_operacion when 'codigo_ip' then 'codigo_ip' when 'codigo' then 'codigo_correo'
    when 'subida' then 'subida_ip' when 'fallo_codigo' then 'intento_codigo' end;
  v_hash:=case when p_operacion in ('codigo_ip','subida') then p_ip_hash else p_correo_hash end;
  if p_operacion<>'solicitud' then
    if v_hash is null or v_hash!~'^[a-f0-9]{64}$' then raise exception 'Clave HMAC inválida' using errcode='22023';end if;
    -- Serializa todos los límites de una misma clave/tipo, también entre procesos.
    perform pg_advisory_xact_lock(hashtextextended(v_tipo||':'||v_hash,0));
    v_now:=clock_timestamp();
    v_dia:=date_trunc('day',v_now at time zone 'America/Guayaquil') at time zone 'America/Guayaquil';
    v_tope:=case p_operacion when 'codigo_ip' then (p_topes->>'codigosIpHora')::integer
      when 'codigo' then (p_topes->>'codigosCorreoDia')::integer
      when 'subida' then (p_topes->>'subidasIpDia')::integer
      when 'fallo_codigo' then (p_topes->>'fallosCorreoDia')::integer end;
    if v_tope is null or v_tope<0 or v_tope>1000000 then raise exception 'Tope inválido' using errcode='22023';end if;
    select count(*),max(created_at) into v_usado,v_ultimo from public.enrollment_rate_events
      where tipo=v_tipo and clave_hash=v_hash and created_at>=case when p_operacion='codigo_ip' then v_now-interval '1 hour' else v_dia end;
    v_permitido:=v_usado<v_tope;
    if p_operacion='codigo' and v_ultimo>v_now-make_interval(secs=>coalesce((p_topes->>'cooldownSegundos')::integer,60)) then v_permitido:=false;end if;
  end if;
  v_global:=case p_operacion when 'codigo' then 'codigos' when 'solicitud' then 'solicitudes' when 'subida' then 'subidas' end;
  if v_global is not null and v_permitido then
    v_global_tope:=(p_topes->>v_global)::integer;
    if v_global_tope is null or v_global_tope<0 or v_global_tope>1000000 then raise exception 'Tope global inválido' using errcode='22023';end if;
    v_permitido:=public.consumir_cupo_inscripcion(v_global,v_global_tope) is not null;
  end if;
  if not v_permitido then
    if p_operacion='subida' and p_solicitud is not null then
      select * into s from public.solicitudes_inscripcion where id=p_solicitud for update;
      if found and s.estado in ('borrador','devuelta') and s.correo_verificado and
        s.nivel_estudios in ('bachiller_exterior','decimo_aprobado','cursando_bachillerato') then
        update public.solicitudes_inscripcion set documento_estudios_pendiente_por_cupo=true where id=s.id;
      end if;
    end if;
    return jsonb_build_object('permitido',false,'motivo','limite');
  end if;
  if v_tipo is not null then insert into public.enrollment_rate_events(tipo,clave_hash,created_at) values(v_tipo,v_hash,v_now);end if;
  return jsonb_build_object('permitido',true);
end $$;
revoke all on function public.reservar_limite_inscripcion(text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.reservar_limite_inscripcion(text,text,text,jsonb,uuid) to service_role;

-- Capturar presupuesto y fila nueva en una misma transacción, sin cobrar duplicados.
create or replace function public.crear_borrador_limitado(p_correo text,p_curso uuid,p_codigo text,p_expira timestamptz,p_topes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_id uuid;v_limite jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('solicitud:'||public.normalizar_correo_inscripcion(p_correo),0));
  select id into v_id from public.solicitudes_inscripcion where correo_normalizado=public.normalizar_correo_inscripcion(p_correo);
  if found then return jsonb_build_object('id',v_id,'creada',false);end if;
  v_limite:=public.reservar_limite_inscripcion('solicitud',null,null,p_topes);
  if not (v_limite->>'permitido')::boolean then return v_limite;end if;
  insert into public.solicitudes_inscripcion(correo,course_id,codigo_verificacion,codigo_expira_at)
    values(p_correo,p_curso,p_codigo,p_expira) returning id into v_id;
  return jsonb_build_object('id',v_id,'creada',true,'permitido',true);
end $$;
revoke all on function public.crear_borrador_limitado(text,uuid,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.crear_borrador_limitado(text,uuid,text,timestamptz,jsonb) to service_role;

create or replace function public.actualizar_config_inscripcion(p_actor uuid,p_abiertas boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_at timestamptz;
begin
  perform 1 from public.users where id=p_actor and rol='admin' and activo for share;
  if not found then raise exception 'Acceso denegado' using errcode='42501';end if;
  if p_abiertas is null then raise exception 'Estado de inscripciones requerido' using errcode='22023';end if;
  update public.app_settings set inscripciones_abiertas=p_abiertas,updated_by=p_actor,updated_at=clock_timestamp()
    where id returning updated_at into v_at;
  if not found then raise exception 'Configuración ausente' using errcode='SI409';end if;
  insert into public.solicitud_auditoria(solicitud_id,actor_id,accion)
    values('00000000-0000-0000-0000-000000000000',p_actor,case when p_abiertas then 'inscripciones_abiertas' else 'inscripciones_cerradas' end);
  return jsonb_build_object('inscripcionesAbiertas',p_abiertas);
end $$;
revoke all on function public.actualizar_config_inscripcion(uuid,boolean) from public,anon,authenticated;
grant execute on function public.actualizar_config_inscripcion(uuid,boolean) to service_role;

create or replace function public.resumen_solicitudes() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('pendientes',count(*) filter(where estado='enviada'),
    'devueltas',count(*) filter(where estado='devuelta'),
    'conMasDe48h',count(*) filter(where estado='enviada' and enviada_at<now()-interval '48 hours'),
    'inscripcionesAbiertas',(select inscripciones_abiertas from public.app_settings where id),
    'contadoresHoy',coalesce((select jsonb_object_agg(tipo,usado) from public.enrollment_counters
      where dia=(now() at time zone 'America/Guayaquil')::date),'{}'::jsonb))
  from public.solicitudes_inscripcion
$$;
revoke all on function public.resumen_solicitudes() from public,anon,authenticated;
grant execute on function public.resumen_solicitudes() to service_role;
notify pgrst,'reload schema';
commit;
