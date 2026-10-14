-- Reversión operativa de A2: retirar primero el endpoint PATCH en el despliegue.
-- Conservar student_profile_audit y sus filas; no deshacer cambios personales.
-- No reejecutar 024 tras esta reversión: la tabla se conserva deliberadamente.
begin;
set local lock_timeout = '5s';
drop function public.save_student_profile(uuid,uuid,uuid,timestamptz,jsonb,boolean);
revoke insert on public.student_profile_audit from service_role;
notify pgrst, 'reload schema';
commit;
