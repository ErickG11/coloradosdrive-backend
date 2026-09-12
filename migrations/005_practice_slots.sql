-- 005_practice_slots.sql
-- ColoradosDrive — horarios de práctica de conducción, confirmación de
-- asistencia y liberación dinámica de cupos (RF-03).
--
-- Relación 1:1 franja-estudiante: cada practice_slot tiene a lo sumo un
-- estudiante asignado (nunca varios) — se infiere de que "si nadie toma
-- el cupo, no habrá práctica ese bloque" solo tiene sentido si la franja
-- es individual.
--
-- Flujo de asignación (no especificado literalmente en el documento, ver
-- docs/adr/007): el admin crea la franja sin estudiante (disponible); el
-- estudiante la reclama por sí mismo (self-service) con una actualización
-- atómica (WHERE status IN ('disponible','liberado')) para evitar que dos
-- estudiantes se queden con la misma franja en una condición de carrera.
--
-- Transiciones de estado:
--   disponible  -> asignado    (estudiante reclama)
--   asignado    -> confirmado  (estudiante confirma dentro de la ventana)
--   asignado    -> liberado    (estudiante cancela)
--   confirmado  -> liberado    (estudiante cancela, incluso ya confirmado)
--   liberado    -> asignado    (otro estudiante de la cohorte reclama)
--   disponible/liberado -> sin_practica (scheduler, a los 5 min antes,
--                                        nadie con student_id asignado)
--   asignado    -> sin_practica (scheduler, a los 5 min, nunca se confirmó)
--   confirmado  -> completado  (scheduler, al pasar scheduled_at + duration)
--
-- `attended` (alcance agregado sobre la marcha, ver docs/adr/007): el
-- instructor registra si el estudiante asistió, solo sobre sus propias
-- franjas ya `completado`.

create type practice_slot_status as enum (
  'disponible',
  'asignado',
  'confirmado',
  'liberado',
  'sin_practica',
  'completado'
);

create table practice_slots (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts (id) on delete restrict,
  instructor_id uuid not null references users (id) on delete restrict,
  student_id uuid references users (id) on delete restrict,
  scheduled_at timestamptz not null,
  duration_minutes integer not null,
  status practice_slot_status not null default 'disponible',
  confirmation_notified_at timestamptz,
  release_notified_at timestamptz,
  confirmed_at timestamptz,
  attended boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint practice_slots_duration_positive check (duration_minutes > 0),

  -- student_id solo puede estar presente en los estados donde hay
  -- realmente un estudiante asignado a la franja.
  constraint practice_slots_student_status_consistency check (
    (status in ('disponible', 'liberado', 'sin_practica') and student_id is null)
    or (status in ('asignado', 'confirmado', 'completado') and student_id is not null)
  ),

  -- Solo tiene sentido registrar asistencia una vez que la práctica ya
  -- pasó y se mantuvo confirmada hasta el final.
  constraint practice_slots_attended_requires_completed check (
    attended is null or status = 'completado'
  )
);

comment on table practice_slots is
  'Franja de práctica de conducción (RF-03): un instructor, una cohorte, a lo sumo un estudiante a la vez. El estudiante reclama, confirma o cancela; el scheduler (node-cron) notifica y cierra franjas vencidas.';
comment on column practice_slots.student_id is
  'NULL cuando la franja está disponible, liberada, o terminó sin práctica. Se limpia explícitamente al cancelar/liberar (ver ExamAttemptService-style reset en practiceSlot.service.ts) para que un futuro estudiante que reclame la misma franja reciba su propia notificación.';
comment on column practice_slots.confirmation_notified_at is
  'Momento en que el scheduler envió la notificación de confirmación (20 min antes). NULL de nuevo tras liberar, para que el siguiente estudiante asignado reciba la suya.';
comment on column practice_slots.release_notified_at is
  'Momento en que se notificó a la cohorte que el cupo quedó libre. NULL de nuevo al reclamarse, para que una futura liberación notifique otra vez.';
comment on column practice_slots.attended is
  'Registrado por el instructor sobre sus propias franjas ya completado. Alcance agregado sobre la marcha en Sprint 4 (ver docs/adr/007) — el documento de tesis todavía dice "solo lectura" para el instructor.';

create trigger practice_slots_set_updated_at
  before update on practice_slots
  for each row
  execute function set_updated_at();

create index practice_slots_cohort_id_idx on practice_slots (cohort_id);
create index practice_slots_instructor_id_idx on practice_slots (instructor_id);
create index practice_slots_student_id_idx on practice_slots (student_id);
-- El scheduler corre cada minuto filtrando por status + scheduled_at:
-- este índice compuesto evita un recorrido completo de la tabla en cada
-- corrida.
create index practice_slots_status_scheduled_at_idx on practice_slots (status, scheduled_at);

-- Solo un usuario con rol 'instructor' puede ser instructor_id (mismo
-- patrón que enforce_enrollment_student_role de la migración 001).
create function enforce_practice_slot_instructor_role()
returns trigger
language plpgsql
as $$
declare
  instructor_role user_role;
begin
  select rol into instructor_role from users where id = new.instructor_id;

  if instructor_role is distinct from 'instructor' then
    raise exception 'practice_slots.instructor_id (%) must reference a user with rol = instructor', new.instructor_id;
  end if;

  return new;
end;
$$;

create trigger practice_slots_enforce_instructor_role
  before insert or update of instructor_id on practice_slots
  for each row
  execute function enforce_practice_slot_instructor_role();

-- Solo un usuario con rol 'estudiante' puede ser student_id, cuando no es NULL.
create function enforce_practice_slot_student_role()
returns trigger
language plpgsql
as $$
declare
  student_role user_role;
begin
  if new.student_id is null then
    return new;
  end if;

  select rol into student_role from users where id = new.student_id;

  if student_role is distinct from 'estudiante' then
    raise exception 'practice_slots.student_id (%) must reference a user with rol = estudiante', new.student_id;
  end if;

  return new;
end;
$$;

create trigger practice_slots_enforce_student_role
  before insert or update of student_id on practice_slots
  for each row
  execute function enforce_practice_slot_student_role();
