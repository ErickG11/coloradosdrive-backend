-- MANUAL: revertir el backend antes. Las solicitudes ya vencidas conservan su estado.
begin;
drop function if exists public.vencer_solicitudes_devueltas(integer,text);
drop function if exists public.listar_objetos_huerfanos_solicitudes(timestamptz,integer);
notify pgrst,'reload schema';
commit;
