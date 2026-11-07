-- MANUAL: revertir el backend antes. Los certificados guardados se conservan.
begin;
drop function if exists public.guardar_certificado_inscripcion(uuid,text,timestamptz,text,text,text,integer,text,text,text);
notify pgrst,'reload schema';
commit;
