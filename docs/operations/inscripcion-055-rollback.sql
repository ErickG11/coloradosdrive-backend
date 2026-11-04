-- MANUAL: detener backend/cron antes de volver a052. No borrar intenciones ni auditoría.
begin;
drop trigger if exists solicitudes_aprobacion_intento on public.solicitudes_inscripcion;
drop function if exists public.guard_aprobacion_intento();
drop function if exists public.tomar_recuperacion_aprobacion(uuid,integer,boolean);
drop function if exists public.cerrar_recuperacion_aprobacion(uuid,uuid);
drop function if exists public.liberar_reclamo_aprobacion_legacy(uuid,timestamptz,integer);
create or replace function public.reclamar_aprobacion_inscripcion(
  p_id uuid,p_actor uuid,p_verif_identidad uuid,p_verif_estudios uuid,p_version_aviso text,p_version_terminos text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;
begin
 if p_actor is null then raise exception 'Actor inválido' using errcode='22023';end if;
 perform 1 from public.solicitudes_inscripcion where id=p_id for update;
 if not found then raise exception 'No existe solicitud' using errcode='SI404';end if;
 perform public.validar_aprobacion_inscripcion(p_id,p_verif_identidad,p_verif_estudios,p_version_aviso,p_version_terminos);
 update public.solicitudes_inscripcion set reviewed_by=p_actor,reviewed_at=clock_timestamp()
  where id=p_id returning * into s;
 return jsonb_build_object('claim',s.reviewed_at,'correo',s.correo,'courseId',s.course_id,
  'solicitadaAt',s.solicitada_at);
end $$;
revoke all on function public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text) to service_role;

commit;
