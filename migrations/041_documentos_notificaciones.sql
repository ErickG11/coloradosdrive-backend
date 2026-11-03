-- T43/T51: notificación y auditoría en la misma transacción que la decisión.
begin;
set local lock_timeout='5s';
alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check check(tipo in (
 'recordatorio_practica','resultado_cancelacion','cupo_disponible','sin_practica_instructor','cambio_realizado','asistencia_corregida','encuesta_practica','documento_aprobado','documento_rechazado'));
create function public.revisar_documento_solicitud(p_solicitud uuid,p_documento uuid,p_actor uuid,p_estado text,p_motivo text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;d public.solicitud_documentos;
begin
 if not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then raise exception 'Acceso denegado' using errcode='42501';end if;
 if p_estado not in ('aprobado','rechazado') then raise exception 'Estado inválido' using errcode='22023';end if;
 if p_estado='rechazado' and nullif(trim(p_motivo),'') is null then raise exception 'Motivo obligatorio' using errcode='22023';end if;
 select * into s from public.solicitudes_inscripcion where id=p_solicitud for update;
 if not found or s.enviada_at is null or s.estado='rechazada' or (s.estado='pendiente_revision' and s.reviewed_at is not null) then raise exception 'Solicitud cerrada' using errcode='SI409';end if;
 select * into d from public.solicitud_documentos where id=p_documento and solicitud_id=s.id for update;
 if not found then raise exception 'Documento inexistente' using errcode='SI404';end if;
 if d.estado<>'recibido' then raise exception 'Documento ya revisado' using errcode='SI411';end if;
 update public.solicitud_documentos set estado=p_estado,reviewed_at=now(),reviewed_by=p_actor,motivo_rechazo=case when p_estado='rechazado' then trim(p_motivo) else null end where id=d.id;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion,documento_id) values(s.id,p_actor,'documento_'||p_estado,d.id);
 if s.student_id is not null then
   insert into public.notifications(user_id,tipo,titulo,mensaje,email_status)
   values(s.student_id,'documento_'||p_estado,'Documento '||p_estado,
     replace(d.tipo_documento,'_',' ')||case when p_estado='rechazado' then ': '||trim(p_motivo) else ': aprobado' end,null);
 end if;
 return jsonb_build_object('id',d.id,'estado',p_estado);
end $$;
revoke all on function public.revisar_documento_solicitud(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.revisar_documento_solicitud(uuid,uuid,uuid,text,text) to service_role;
commit;
