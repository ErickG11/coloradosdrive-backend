-- F20. MANUAL después de 052. Vencimiento de devueltas y detección de objetos huérfanos.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)') is null
  or to_regclass('storage.objects') is null then
  raise exception '053 requiere 042–052 completas y el esquema storage';end if;
end $$;

-- Devueltas sin reenviar tras p_dias pasan a rechazada con motivo VENCIDA (solo este trabajo
-- puede usar ese motivo). Salta filas bloqueadas por otra transacción y devuelve cuántas cambió.
create or replace function public.vencer_solicitudes_devueltas(p_dias integer,p_mensaje text)
returns integer language plpgsql security invoker set search_path='' as $$
declare r record;v_n integer:=0;
begin
 if p_dias is null or p_dias<1 or p_dias>365 or p_mensaje is null or char_length(p_mensaje) not between 10 and 300 then
  raise exception 'Parámetros inválidos' using errcode='22023';end if;
 for r in select id from public.solicitudes_inscripcion where estado='devuelta'
  and devuelta_at<clock_timestamp()-make_interval(days=>p_dias) order by devuelta_at,id for update skip locked loop
  update public.solicitudes_inscripcion set estado='rechazada',rechazo_motivo_codigo='VENCIDA',motivo_rechazo=p_mensaje,
   reviewed_at=clock_timestamp(),reviewed_by=null where id=r.id;
  insert into public.solicitud_auditoria(solicitud_id,accion) values(r.id,'solicitud_vencida');
  v_n:=v_n+1;
 end loop;
 return v_n;
end $$;
revoke all on function public.vencer_solicitudes_devueltas(integer,text) from public,anon,authenticated;
grant execute on function public.vencer_solicitudes_devueltas(integer,text) to service_role;

-- Objetos del bucket de solicitudes más viejos que p_antes sin ninguna fila que los referencie.
-- Solo lista: el borrado lo hace el backend por la API de Storage.
create or replace function public.listar_objetos_huerfanos_solicitudes(p_antes timestamptz,p_limite integer)
returns text[] language sql stable security invoker set search_path='' as $$
 select coalesce(array_agg(o.name),'{}') from (
  select name from storage.objects where bucket_id='solicitudes-documentos' and created_at<p_antes
   and not exists(select 1 from public.solicitud_documentos d where d.storage_path=storage.objects.name)
   order by created_at,name limit least(greatest(coalesce(p_limite,100),1),500)) o
$$;
revoke all on function public.listar_objetos_huerfanos_solicitudes(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.listar_objetos_huerfanos_solicitudes(timestamptz,integer) to service_role;
notify pgrst,'reload schema';
commit;
