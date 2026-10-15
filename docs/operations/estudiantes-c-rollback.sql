-- Reversión manual de C. Requiere aprobación; retirar primero los endpoints C.
-- Conserva columnas, asignaciones y metadatos de auditoría en enrollments.
begin;
set local lock_timeout='5s';
drop function if exists public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date);
notify pgrst, 'reload schema';
commit;
