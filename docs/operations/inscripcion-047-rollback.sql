-- MANUAL: revertir backend antes. La marca aditiva se conserva como evidencia.
begin;
drop function if exists public.guardar_datos_inscripcion(uuid,jsonb,text,text);
notify pgrst,'reload schema';
commit;
