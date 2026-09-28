-- 009_enable_rls.sql
--
-- ==========================================================================
-- YA APLICADA MANUALMENTE en el proyecto real de Supabase (confirmado: las
-- 12 tablas de public muestran RLS activo y cero políticas). Este archivo
-- existe solo para que el repositorio refleje el estado real de la base de
-- datos — NO volver a ejecutarlo.
-- ==========================================================================
--
-- Auditoría de seguridad: RLS estaba deshabilitado en toda tabla de Sprint
-- 1-4 (users, courses, cohorts, enrollments, exams, questions,
-- question_options, exam_attempts, attempt_answers, practice_slots) — solo
-- solicitudes_inscripcion/solicitud_documentos lo tenían, desde
-- 007_solicitudes_inscripcion.sql.
--
-- El backend usa exclusivamente supabaseAdmin (service_role), que ignora
-- RLS por diseño (BYPASSRLS) sin importar si está activo o con qué
-- políticas — así que esto no cambia nada de su funcionamiento. El
-- frontend nunca hace `.from(...)` directo con la anon key (todo pasa por
-- la API del backend); su único uso de Realtime es Broadcast
-- (`realtime.service.ts`), no `postgres_changes`, así que tampoco depende
-- de RLS de tabla. Por eso alcanza con activar RLS sin crear ninguna
-- política nueva: sin políticas, deniega todo a `anon`/`authenticated`,
-- que es exactamente el comportamiento buscado (el backend puede todo vía
-- service_role; el frontend con anon key no puede leer ni escribir nada
-- directamente).

alter table users enable row level security;
alter table courses enable row level security;
alter table cohorts enable row level security;
alter table enrollments enable row level security;
alter table exams enable row level security;
alter table questions enable row level security;
alter table question_options enable row level security;
alter table exam_attempts enable row level security;
alter table attempt_answers enable row level security;
alter table practice_slots enable row level security;
