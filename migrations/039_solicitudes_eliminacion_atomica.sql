-- T15: Storage se elimina primero conservando rutas hasta confirmar éxito.
begin;
create or replace function public.eliminar_solicitud_reclamada(p_solicitud uuid,p_claim timestamptz,p_actor uuid,p_accion text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.solicitudes_inscripcion where id=p_solicitud and estado<>'aprobada' and reviewed_at=p_claim for update;
 if not found then raise exception 'Solicitud no eliminable' using errcode='SI409'; end if;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(p_solicitud,p_actor,p_accion);
 delete from public.solicitud_documentos where solicitud_id=p_solicitud;
 delete from public.solicitudes_inscripcion where id=p_solicitud;
end $$;
revoke all on function public.eliminar_solicitud_reclamada(uuid,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.eliminar_solicitud_reclamada(uuid,timestamptz,uuid,text) to service_role;
commit;
