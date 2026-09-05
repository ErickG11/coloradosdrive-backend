-- 004_exams.sql
-- ColoradosDrive — sistema de exámenes con calificación automatizada (RF-02).
--
-- Modelo de datos según el documento de titulación:
--   * exams: examen de un curso, tipo práctica/definitivo.
--   * questions: banco de preguntas de un examen, opción múltiple o texto
--     abierto. `synonyms` va en JSONB porque el documento lo especifica
--     literalmente como ejemplo de uso de JSONB (sección PostgreSQL).
--   * question_options: opciones de una pregunta de opción múltiple. Tabla
--     relacional separada (no JSONB), consistente con el patrón de
--     Sprint 1/2 para datos con forma fija y consultables por columna.
--   * exam_attempts: un intento de un estudiante sobre un examen.
--   * attempt_answers: la respuesta de un intento a cada pregunta.

-- =========================================================================
-- exams
-- =========================================================================
create type exam_type as enum ('practica', 'definitivo');

create table exams (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete restrict,
  title text not null,
  type exam_type not null,
  time_limit_minutes integer not null,
  passing_score_percent numeric(5, 2) not null,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint exams_time_limit_positive check (time_limit_minutes > 0),
  constraint exams_passing_score_range
    check (passing_score_percent >= 0 and passing_score_percent <= 100)
);

comment on table exams is
  'Examen de un curso (RF-02): práctica (intentos ilimitados) o definitivo (exactamente 1 intento, no repetible una vez aprobado).';
comment on column exams.time_limit_minutes is
  'Tiempo límite del examen. El backend es la autoridad: un intento se auto-finaliza si se excede (ver docs/adr/005).';

create trigger exams_set_updated_at
  before update on exams
  for each row
  execute function set_updated_at();

create index exams_course_id_idx on exams (course_id);

-- =========================================================================
-- questions
-- =========================================================================
create type question_type as enum ('opcion_multiple', 'texto_abierto');

create table questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams (id) on delete cascade,
  type question_type not null,
  prompt text not null,
  order_index integer not null,
  points numeric(6, 2) not null,
  correct_answer_text text,
  synonyms jsonb,
  created_at timestamptz not null default now(),

  constraint questions_points_positive check (points > 0),
  -- Solo las preguntas de texto abierto se califican por Levenshitein
  -- contra correct_answer_text/synonyms; las de opción múltiple se
  -- califican por question_options.is_correct.
  constraint questions_open_text_has_answer check (
    (type = 'texto_abierto' and correct_answer_text is not null)
    or (type = 'opcion_multiple' and correct_answer_text is null)
  )
);

comment on table questions is
  'Pregunta de un examen: opción múltiple (calificada por question_options) o texto abierto (calificada por distancia de Levenshtein, ver docs/adr/004).';
comment on column questions.synonyms is
  'Arreglo JSON de cadenas: respuestas alternativas aceptadas para texto abierto, además de correct_answer_text. Ejemplo explícito de uso de JSONB en el documento de titulación.';

create index questions_exam_id_idx on questions (exam_id);
create unique index questions_exam_order_unique on questions (exam_id, order_index);

-- =========================================================================
-- question_options
-- =========================================================================
create table question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  order_index integer not null
);

comment on table question_options is
  'Opciones de una pregunta de opción múltiple. Nunca se expone is_correct al estudiante antes de calificar (ver docs/adr y RBAC de exam.routes).';

create index question_options_question_id_idx on question_options (question_id);
create unique index question_options_question_order_unique on question_options (question_id, order_index);

-- Solo las preguntas de opción múltiple pueden tener opciones: un FK
-- normal no puede expresar esta restricción de "tipo", se aplica con
-- un trigger (mismo patrón que enforce_enrollment_student_role en 001).
create function enforce_option_question_type()
returns trigger
language plpgsql
as $$
declare
  q_type question_type;
begin
  select type into q_type from questions where id = new.question_id;

  if q_type is distinct from 'opcion_multiple' then
    raise exception 'question_options.question_id (%) must reference a question with type = opcion_multiple', new.question_id;
  end if;

  return new;
end;
$$;

create trigger question_options_enforce_question_type
  before insert or update of question_id on question_options
  for each row
  execute function enforce_option_question_type();

-- =========================================================================
-- exam_attempts
-- =========================================================================
create type attempt_status as enum ('en_progreso', 'completado');

create table exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams (id) on delete restrict,
  student_id uuid not null references users (id) on delete restrict,
  status attempt_status not null default 'en_progreso',
  score_percent numeric(5, 2),
  passed boolean,
  started_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint exam_attempts_score_range
    check (score_percent is null or (score_percent >= 0 and score_percent <= 100)),
  constraint exam_attempts_completed_has_score check (
    (status = 'completado' and score_percent is not null and passed is not null and completed_at is not null)
    or (status = 'en_progreso' and score_percent is null and passed is null and completed_at is null)
  )
);

comment on table exam_attempts is
  'Intento de un estudiante sobre un examen. Reglas de número de intentos (práctica ilimitada, definitivo exactamente 1, no repetible si ya aprobado) se aplican en la capa de servicio, no aquí.';
comment on column exam_attempts.started_at is
  'Usado como referencia de autoridad del servidor para el tiempo límite: un intento en_progreso se auto-finaliza si now() > started_at + exams.time_limit_minutes.';

create index exam_attempts_exam_id_idx on exam_attempts (exam_id);
create index exam_attempts_student_id_idx on exam_attempts (student_id);
create index exam_attempts_exam_student_idx on exam_attempts (exam_id, student_id);

-- Solo un usuario con rol 'estudiante' puede tener intentos (mismo patrón
-- que enforce_enrollment_student_role en 001).
create function enforce_attempt_student_role()
returns trigger
language plpgsql
as $$
declare
  student_role user_role;
begin
  select rol into student_role from users where id = new.student_id;

  if student_role is distinct from 'estudiante' then
    raise exception 'exam_attempts.student_id (%) must reference a user with rol = estudiante', new.student_id;
  end if;

  return new;
end;
$$;

create trigger exam_attempts_enforce_student_role
  before insert or update of student_id on exam_attempts
  for each row
  execute function enforce_attempt_student_role();

-- =========================================================================
-- attempt_answers
-- =========================================================================
create table attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references exam_attempts (id) on delete cascade,
  question_id uuid not null references questions (id) on delete restrict,
  selected_option_id uuid references question_options (id) on delete restrict,
  text_answer text,
  is_correct boolean not null,
  similarity_score numeric(5, 4),

  constraint attempt_answers_similarity_range
    check (similarity_score is null or (similarity_score >= 0 and similarity_score <= 1)),
  constraint attempt_answers_one_answer_shape check (
    (selected_option_id is not null and text_answer is null)
    or (selected_option_id is null and text_answer is not null)
  )
);

comment on table attempt_answers is
  'Respuesta de un intento a una pregunta. selected_option_id para opción múltiple, text_answer para texto abierto (exactamente uno de los dos, ver attempt_answers_one_answer_shape).';
comment on column attempt_answers.similarity_score is
  'Ratio de similitud de Levenshtein (0-1) contra la mejor coincidencia entre correct_answer_text y synonyms. Solo aplica a texto abierto; NULL en opción múltiple.';

create index attempt_answers_attempt_id_idx on attempt_answers (attempt_id);
create unique index attempt_answers_attempt_question_unique on attempt_answers (attempt_id, question_id);
