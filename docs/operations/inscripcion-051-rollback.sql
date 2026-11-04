-- MANUAL: revertir el backend antes. Las solicitudes devueltas/rechazadas conservan su estado.
begin;
drop function if exists public.devolver_solicitud_inscripcion(uuid,uuid,text,text,text);
drop function if exists public.rechazar_solicitud_inscripcion(uuid,uuid,text,text,text,text,integer);
drop function if exists public.validar_aprobacion_inscripcion(uuid,uuid,uuid,text,text);
notify pgrst,'reload schema';
commit;
