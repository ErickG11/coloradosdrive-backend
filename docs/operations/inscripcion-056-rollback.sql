-- MANUAL: retirar endpoint antes del rollback. Conservar evidencia, no desconfirmar alumnos.
begin;
set local lock_timeout='5s';
drop function if exists public.confirmar_identidad_presencial_admin(uuid,uuid,text);
-- La tabla y su guarda append-only se conservan deliberadamente como evidencia.
notify pgrst,'reload schema';
commit;
