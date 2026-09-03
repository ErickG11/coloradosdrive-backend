-- 002_enrollments_monto.sql
-- Agrega el monto total de la matrícula (RF-01: "registra el monto total
-- del curso"). Se copia desde cohorts.precio en el momento de crear la
-- inscripción, no se referencia dinámicamente: así, si el precio de la
-- cohorte cambia después, no altera retroactivamente lo que un estudiante
-- ya matriculado debe pagar.

alter table enrollments
  add column monto_total numeric(10, 2) not null,
  add constraint enrollments_monto_total_non_negative check (monto_total >= 0);

comment on column enrollments.monto_total is
  'Monto total de la matrícula, copiado de cohorts.precio al momento de inscribir. No cambia si el precio de la cohorte cambia después.';
