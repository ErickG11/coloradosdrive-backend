-- 001_init.sql
-- ColoradosDrive — esquema núcleo: usuarios, cursos, cohortes e inscripciones.
--
-- Convenciones:
--   * Toda tabla de negocio usa uuid como PK (gen_random_uuid(), vía pgcrypto).
--   * created_at / updated_at en timestamptz, updated_at mantenido por trigger.
--   * Los enums fijan el conjunto de valores válidos a nivel de base de datos,
--     no solo en la capa de aplicación.

create extension if not exists "pgcrypto";

-- Función reutilizable para mantener updated_at en cada UPDATE.
create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- users
-- =========================================================================
-- Extiende auth.users (Supabase Auth) con los datos propios del dominio de
-- ColoradosDrive: cédula (identificación única en Ecuador), datos de
-- contacto y el rol de negocio (admin/estudiante/instructor), que es
-- distinto del rol interno de Supabase Auth.
create type user_role as enum ('admin', 'estudiante', 'instructor');

create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  cedula varchar(10) not null,
  nombre_completo text not null,
  telefono varchar(20),
  rol user_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Formato de cédula ecuatoriana: 10 dígitos numéricos. El dígito
  -- verificador (algoritmo módulo 10) se valida en la capa de aplicación
  -- (express-validator), no aquí; esta constraint solo garantiza el shape.
  constraint users_cedula_format check (cedula ~ '^[0-9]{10}$'),
  constraint users_cedula_unique unique (cedula)
);

comment on table users is
  'Perfil de negocio de cada usuario autenticado. 1:1 con auth.users; se elimina en cascada si se elimina el usuario de Supabase Auth.';
comment on column users.cedula is
  'Cédula de identidad ecuatoriana, única a nivel de base de datos. Formato validado aquí; dígito verificador validado en la API.';
comment on column users.rol is
  'Rol de negocio usado por el middleware de RBAC (admin/estudiante/instructor). No confundir con el rol interno de Supabase Auth.';

create trigger users_set_updated_at
  before update on users
  for each row
  execute function set_updated_at();

create index users_rol_idx on users (rol);

-- =========================================================================
-- courses
-- =========================================================================
-- Catálogo de cursos que ofrece la escuela. "tipo" distingue los dos tipos
-- de curso de conducción que maneja ColoradosDrive (tipo A / tipo B).
create type course_type as enum ('A', 'B');

create table courses (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo course_type not null,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table courses is
  'Catálogo de cursos ofrecidos por la escuela de conducción (tipo A / tipo B).';
comment on column courses.tipo is
  'Tipo de curso de conducción: A o B.';

create trigger courses_set_updated_at
  before update on courses
  for each row
  execute function set_updated_at();

-- =========================================================================
-- cohorts
-- =========================================================================
-- Una edición concreta de un curso (fechas y precio propios), ya que el
-- mismo curso puede ofrecerse varias veces con precio diferenciado por
-- cohorte (no un precio único a nivel de curso).
create table cohorts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete restrict,
  nombre text not null,
  precio numeric(10, 2) not null,
  cupo_maximo integer not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cohorts_precio_non_negative check (precio >= 0),
  constraint cohorts_cupo_positive check (cupo_maximo > 0),
  constraint cohorts_fechas_validas check (fecha_fin >= fecha_inicio)
);

comment on table cohorts is
  'Edición concreta de un curso: fechas, cupo y precio propios (precio diferenciado por cohorte, no fijo por curso).';
comment on column cohorts.precio is
  'Precio de esta cohorte específica. Cohortes del mismo curso pueden tener precios distintos.';

create trigger cohorts_set_updated_at
  before update on cohorts
  for each row
  execute function set_updated_at();

create index cohorts_course_id_idx on cohorts (course_id);

-- =========================================================================
-- enrollments
-- =========================================================================
-- Relación estudiante-cohorte. Un estudiante puede tener historial en
-- varias cohortes a lo largo del tiempo, pero solo puede estar ACTIVO en
-- una a la vez: se aplica con un índice único parcial sobre student_id
-- filtrado a status = 'activo'.
create type enrollment_status as enum ('activo', 'finalizado', 'retirado');

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references users (id) on delete restrict,
  cohort_id uuid not null references cohorts (id) on delete restrict,
  status enrollment_status not null default 'activo',
  fecha_inscripcion timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Un mismo estudiante no puede tener dos registros de inscripción para
  -- la misma cohorte (evita duplicados accidentales).
  constraint enrollments_student_cohort_unique unique (student_id, cohort_id)
);

comment on table enrollments is
  'Inscripción de un estudiante en una cohorte. Un estudiante solo puede estar activo en una cohorte a la vez (ver enrollments_one_active_per_student).';
comment on column enrollments.status is
  'activo: cursando actualmente. finalizado: completó la cohorte. retirado: abandonó antes de finalizar.';

create trigger enrollments_set_updated_at
  before update on enrollments
  for each row
  execute function set_updated_at();

create index enrollments_cohort_id_idx on enrollments (cohort_id);

-- Un estudiante solo puede tener UNA inscripción activa a la vez, sin
-- importar la cohorte.
create unique index enrollments_one_active_per_student
  on enrollments (student_id)
  where status = 'activo';

-- Solo un usuario con rol 'estudiante' puede tener inscripciones: un FK
-- normal no puede expresar esta restricción de "tipo", por lo que se
-- aplica con un trigger.
create function enforce_enrollment_student_role()
returns trigger
language plpgsql
as $$
declare
  student_role user_role;
begin
  select rol into student_role from users where id = new.student_id;

  if student_role is distinct from 'estudiante' then
    raise exception 'enrollments.student_id (%) must reference a user with rol = estudiante', new.student_id;
  end if;

  return new;
end;
$$;

create trigger enrollments_enforce_student_role
  before insert or update of student_id on enrollments
  for each row
  execute function enforce_enrollment_student_role();
