-- Manual después de revertir migraciones posteriores. Conservar contadores/eventos/auditoría.
begin;
set local lock_timeout='5s';
drop function if exists public.crear_borrador_limitado(text,uuid,text,timestamptz,jsonb);
drop function if exists public.reservar_limite_inscripcion(text,text,text,jsonb,uuid);
drop function if exists public.actualizar_config_inscripcion(uuid,boolean);
create or replace function public.resumen_solicitudes() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'pendientes',count(*) filter (where estado = 'enviada'),
    'devueltas',count(*) filter (where estado = 'devuelta'),
    'conMasDe48h',count(*) filter (where estado = 'enviada' and enviada_at < now() - interval '48 hours'),
    'inscripcionesAbiertas',(select inscripciones_abiertas from public.app_settings where id))
  from public.solicitudes_inscripcion
$$;


revoke all on function public.resumen_solicitudes() from public,anon,authenticated;
grant execute on function public.resumen_solicitudes() to service_role;
notify pgrst,'reload schema';
commit;
