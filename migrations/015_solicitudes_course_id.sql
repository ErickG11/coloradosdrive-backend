-- 015_solicitudes_course_id.sql
-- Fase 3: la solicitud de inscripción online necesita saber para qué curso
-- (Tipo A / Tipo B) aplica el postulante, para poder asignarle
-- automáticamente una cohorte de ese curso al aprobarla — sin esta
-- columna, assignCohort no tiene con qué filtrar candidatas. Se captura
-- desde el primer paso del flujo (verificar-correo): "Solicitar
-- inscripción" ya se piensa como una acción por curso desde la landing.
--
-- La tabla no tiene filas todavía, así que se agrega NOT NULL directamente
-- sin necesidad de backfill.
alter table solicitudes_inscripcion
  add column course_id uuid not null references courses (id) on delete restrict;

create index solicitudes_inscripcion_course_id_idx
  on solicitudes_inscripcion (course_id);
