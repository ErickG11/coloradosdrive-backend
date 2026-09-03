-- 003_seed_courses.sql
-- Siembra los dos cursos que ofrece la escuela (sección "Descripción de la
-- organización" del documento de titulación). La tabla `courses` existe
-- desde 001_init.sql pero nunca se sembró: sin estas filas, no hay ningún
-- curso al que asociar una cohorte.

insert into courses (nombre, tipo) values
  ('Motocicletas', 'A'),
  ('Vehículos livianos (transmisión manual y automática)', 'B');
