-- MANUAL: revertir el backend antes. Las solicitudes aprobadas y sus matrículas se conservan.
begin;
drop function if exists public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text);
drop function if exists public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric);
notify pgrst,'reload schema';
commit;
