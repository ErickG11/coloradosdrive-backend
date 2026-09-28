-- 006_matricula_v2_schema.sql
-- Primer paso de la reapertura de RF-01 (matrícula v2): separa el dato de
-- horas mínimas por tipo de curso, el objetivo real de horas por matrícula,
-- y el ciclo de vida de un estudiante que aún no tiene cohorte asignada
-- (solicitud online -> verificación -> pago -> matrícula manual del admin).
--
-- No se recrean tablas: courses/cohorts ya modelan "tipo de curso" y
-- "cohorte" por separado desde 001_init.sql (courses.tipo + cohorts.course_id
-- + cohorts.precio propio). Este cambio solo agrega columnas nuevas; no
-- toca enrollments.cohort_id/status ni ninguna tabla de exámenes (RF-02).

-- =========================================================================
-- courses.horas_requeridas
-- =========================================================================
-- Horas de práctica mínimas de referencia por tipo de curso. Puramente
-- informativo: no se valida ni se hace cumplir contra nada (ver
-- enrollments.horas_practica_objetivo para el número que sí se mide).
alter table courses
  add column horas_requeridas integer;

comment on column courses.horas_requeridas is
  'Horas de práctica mínimas de referencia (dato regulatorio) para este tipo de curso. Solo informativo: no se valida contra matrículas ni sesiones de práctica.';

-- Backfill: mínimo regulatorio de 15 horas, igual para los dos tipos de
-- curso ya sembrados en 003_seed_courses.sql (Motocicletas / Vehículos
-- livianos).
update courses set horas_requeridas = 15;

-- =========================================================================
-- enrollments.horas_practica_objetivo
-- =========================================================================
-- Objetivo real de horas de práctica para ESTA matrícula específica. Se
-- completa en un módulo futuro (horarios/matriculación), a partir de las
-- sesiones de práctica reales que el admin programe para el estudiante.
-- Es el único número contra el que se medirán "horas cubiertas" para el
-- certificado (RF-07, módulo posterior) — nunca contra
-- courses.horas_requeridas.
alter table enrollments
  add column horas_practica_objetivo integer;

comment on column enrollments.horas_practica_objetivo is
  'Horas de práctica objetivo para esta matrícula, usadas para medir "horas cubiertas" en el certificado (RF-07, módulo futuro). Se calcula desde las sesiones de práctica reales; no se copia de courses.horas_requeridas ni se compara contra ella.';

-- =========================================================================
-- users.status / users.debe_cambiar_password
-- =========================================================================
-- Ciclo de vida del estudiante antes/después de tener cohorte asignada.
-- Solo tiene sentido para rol = 'estudiante'; se deja nullable en vez de
-- forzar un valor sin sentido para admin/instructor.
create type student_status as enum (
  'pendiente_verificacion',
  'verificado',
  'pagado_esperando_cohorte',
  'activo',
  'rechazado',
  'expirado'
);

alter table users
  add column status student_status,
  add column debe_cambiar_password boolean not null default false;

comment on column users.status is
  'Estado del estudiante en el flujo de inscripción (solicitud -> verificación -> pago -> matrícula). NULL para admin/instructor, donde no aplica.';
comment on column users.debe_cambiar_password is
  'Si es true, el estudiante debe cambiar su contraseña temporal antes de acceder a cualquier otra ruta protegida de estudiante.';

-- Backfill: los estudiantes ya existentes (creados bajo el flujo de
-- Sprint 2, ya matriculados y usando el sistema) quedan 'activo' y sin
-- forzar cambio de contraseña (debe_cambiar_password ya es false por el
-- DEFAULT de la columna), para no romper su acceso actual.
update users
  set status = 'activo'
  where rol = 'estudiante';
