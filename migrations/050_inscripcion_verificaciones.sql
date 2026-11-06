-- F14. MANUAL después de 049. Verificaciones del admin append-only y listado seguro.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.enviar_solicitud_inscripcion(uuid,text,text,text)') is null
  or to_regclass('public.solicitud_verificaciones') is null
  or to_regclass('public.solicitudes_admin') is null then
  raise exception '050 requiere 042–049 completas';end if;
end $$;

-- Registra una verificación solo sobre una solicitud enviada y sin decisión en curso. La
-- fila es append-only (trigger de 042). Una verificación de estudios con método que habilita
-- (p_habilita lo decide el backend con el catálogo) fija archivo_verificado_at del certificado.
create or replace function public.registrar_verificacion_inscripcion(
  p_id uuid,p_actor uuid,p_tipo text,p_metodo text,p_resultado text,p_nota text,p_habilita boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;v public.solicitud_verificaciones;
begin
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found or s.estado='borrador' then raise exception 'No existe solicitud' using errcode='SI404';end if;
 if s.estado<>'enviada' then raise exception 'La acción no corresponde al estado' using errcode='SI435';end if;
 if s.reviewed_at is not null then raise exception 'Decisión en curso' using errcode='SI409';end if;
 if s.nivel_estudios is null or s.datos_actualizados_at is null then
  raise exception 'Datos incompletos' using errcode='SI422';end if;
 insert into public.solicitud_verificaciones(solicitud_id,tipo,metodo,resultado,nota,actor_id)
  values(p_id,p_tipo,p_metodo,p_resultado,p_nota,p_actor) returning * into v;
 if p_tipo='estudios' and p_resultado='verificado' and coalesce(p_habilita,false) then
  update public.solicitud_documentos set archivo_verificado_at=v.creado_at
   where solicitud_id=p_id and tipo_documento='certificado_estudios'
   and storage_path is not null and archivo_eliminado_at is null;
 end if;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion)
  values(p_id,p_actor,'verificacion_'||p_tipo);
 return jsonb_build_object('id',v.id,'tipo',v.tipo,'metodo',v.metodo,'resultado',v.resultado,
  'nota',v.nota,'createdAt',v.creado_at);
end $$;
revoke all on function public.registrar_verificacion_inscripcion(uuid,uuid,text,text,text,text,boolean)
 from public,anon,authenticated;
grant execute on function public.registrar_verificacion_inscripcion(uuid,uuid,text,text,text,text,boolean)
 to service_role;

-- Misma guarda de 042, más una excepción: fijar archivo_verificado_at sin cambiar nada más.
create or replace function public.guard_solicitud_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare s public.solicitudes_inscripcion;
begin
  select * into s from public.solicitudes_inscripcion where id = new.solicitud_id for update;
  if not found then raise exception 'Solicitud inexistente' using errcode = 'SI404'; end if;
  if tg_table_name = 'solicitud_documentos' then
    if new.tipo_documento <> 'certificado_estudios' or
      (tg_op = 'UPDATE' and old.tipo_documento <> 'certificado_estudios') then
      raise exception 'Documento legacy de solo lectura' using errcode = 'SI410';
    end if;
    -- Retención: únicamente retirar la ruta y registrar la eliminación, incluso decididas.
    if tg_op = 'UPDATE' and old.storage_path is not null and new.storage_path is null
      and new.archivo_eliminado_at is not null
      and (to_jsonb(new) - 'storage_path' - 'archivo_eliminado_at') =
          (to_jsonb(old) - 'storage_path' - 'archivo_eliminado_at') then return new; end if;
    -- Verificación del admin: únicamente marcar el archivo como verificado.
    if tg_op = 'UPDATE' and old.archivo_verificado_at is distinct from new.archivo_verificado_at
      and (to_jsonb(new) - 'archivo_verificado_at') = (to_jsonb(old) - 'archivo_verificado_at')
      then return new; end if;
  end if;
  if s.estado not in ('borrador','devuelta') then
    raise exception 'La solicitud no admite cambios en este estado' using errcode = 'SI409';
  end if;
  return new;
end $$;
revoke all on function public.guard_solicitud_edit() from public,anon,authenticated;

-- Listado del admin con búsqueda parametrizada: los comodines de q se escapan y nunca se
-- interpolan en filtros PostgREST. Orden: enviadas más antiguas, devueltas, decididas recientes.
create or replace function public.listar_solicitudes_admin(p_estado text,p_q text,p_page integer,p_size integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_like text;v_total integer;v_items jsonb;
begin
 if p_estado is not null and p_estado not in ('enviada','devuelta','aprobada','rechazada') then
  raise exception 'Estado inválido' using errcode='22023';end if;
 if p_page is null or p_page<1 or p_page>1000000 or p_size is null or p_size<1 or p_size>100 then
  raise exception 'Paginación inválida' using errcode='22023';end if;
 v_like:=case when p_q is null or btrim(p_q)='' then null
  else '%'||replace(replace(replace(btrim(p_q),'\','\\'),'%','\%'),'_','\_')||'%' end;
 select count(*) into v_total from public.solicitudes_admin s
  where (p_estado is null or s.estado=p_estado)
  and (v_like is null or s.cedula ilike v_like escape '\' or s.nombre_completo ilike v_like escape '\'
   or s.correo ilike v_like escape '\');
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'courseId',t.course_id,'correo',t.correo,
  'nombres',t.nombres,'apellidos',t.apellidos,'nombreCompleto',t.nombre_completo,'cedula',t.cedula,
  'estado',t.estado,'nivelEstudios',t.nivel_estudios,'enviadaAt',t.enviada_at,
  'devueltaAt',t.devuelta_at,'createdAt',t.created_at)
  order by t.orden_grupo,t.pendiente_desde asc nulls last,t.decidida_at desc nulls last,t.id),'[]'::jsonb)
 into v_items
 from (select * from public.solicitudes_admin s
  where (p_estado is null or s.estado=p_estado)
  and (v_like is null or s.cedula ilike v_like escape '\' or s.nombre_completo ilike v_like escape '\'
   or s.correo ilike v_like escape '\')
  order by s.orden_grupo,s.pendiente_desde asc nulls last,s.decidida_at desc nulls last,s.id
  limit p_size offset (p_page-1)*p_size) t;
 return jsonb_build_object('items',v_items,'total',v_total,'page',p_page,'pageSize',p_size);
end $$;
revoke all on function public.listar_solicitudes_admin(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.listar_solicitudes_admin(text,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
