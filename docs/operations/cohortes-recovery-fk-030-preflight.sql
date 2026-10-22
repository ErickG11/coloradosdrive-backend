-- Preflight del borrador 030 (FK de student_practice_recovery.cohort_id). SOLO LECTURA.
-- No imprime alumnos: solo conteos.
begin read only;

-- P7. Filas cuyo cohort_id no existe en cohorts. Esperado 0; si no, 030 aborta.
select count(*) as huerfanas from public.student_practice_recovery r
where not exists (select 1 from public.cohorts c where c.id = r.cohort_id);

-- Filas cuyo slot_id no existe (informativo; 030 no agrega FK de slot_id).
select count(*) as huerfanas_slot from public.student_practice_recovery r
where not exists (select 1 from public.practice_slots s where s.id = r.slot_id);

-- La FK aún no existe (esperado 0; si da 1, 030 ya se aplicó).
select count(*) as fk_030_presente from pg_constraint
where conrelid = 'public.student_practice_recovery'::regclass
  and conname = 'student_practice_recovery_cohort_fkey';

-- Referencias actuales a cohorts y su acción de borrado (esperado: RESTRICT en
-- enrollments_cohort_id_fkey, enrollments_cohort_course_fkey y practice_slots_cohort_id_fkey).
select conrelid::regclass as tabla, conname, pg_get_constraintdef(oid) as definicion
from pg_constraint where confrelid = 'public.cohorts'::regclass order by 1, 2;

rollback;
