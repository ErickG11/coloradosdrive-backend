-- MANUAL: revertir primero el backend de F19. Las confirmaciones ya guardadas en enrollments se conservan.
begin;
drop function if exists public.confirmar_identidad_presencial(uuid,uuid,boolean);
drop function if exists public.franjas_identidad_pendiente(uuid,uuid[]);
drop function if exists public.certificado_original_requerido(uuid);
notify pgrst,'reload schema';
commit;
