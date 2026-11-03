-- MANUAL: revertir el backend antes. Las solicitudes ya enviadas conservan su estado.
begin;
drop function if exists public.enviar_solicitud_inscripcion(uuid,text,text,text);
notify pgrst,'reload schema';
commit;
