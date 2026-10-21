-- Reversión MANUAL del borrador 030, con aprobación. No toca datos.
-- Tras revertir, el servidor sigue contando las filas de recuperación antes de
-- eliminar una cohorte, pero la base deja de impedirlo.
begin;
set local lock_timeout = '5s';
alter table public.student_practice_recovery
  drop constraint if exists student_practice_recovery_cohort_fkey;
notify pgrst, 'reload schema';
commit;
