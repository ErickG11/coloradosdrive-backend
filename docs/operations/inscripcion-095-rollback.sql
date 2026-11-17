-- MANUAL: retirar el backend de la 095 antes del rollback.
-- Restaura la función de la 056 (ventana de 48 horas y motivo obligatorio). La evidencia se conserva.
begin;
set local lock_timeout='5s';
drop function if exists public.confirmar_identidad_presencial_admin(uuid,uuid,text);
-- Ejecutar a continuación el bloque create or replace function de migrations/056_identidad_presencial_admin.sql
-- con sus revoke/grant. Las columnas slot_id y motivo pueden quedar nulables; no se restauran los NOT NULL
-- porque las filas creadas con la 095 pueden tenerlas nulas y son evidencia append-only.
notify pgrst,'reload schema';
commit;
