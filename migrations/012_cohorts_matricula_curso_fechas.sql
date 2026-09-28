-- 012_cohorts_matricula_curso_fechas.sql
-- Fase 1 del flujo de inscripción rediseñado.
--
-- La escuela maneja dos períodos distintos por cohorte y así lo reporta a
-- la ANT: un período de matrícula (cuándo se puede inscribir gente, y cuyo
-- fin es el plazo real que se le comunica al estudiante para entregar
-- documentos físicos) y, por separado, un período de curso/prácticas
-- (ventana dentro de la cual deben caber todas las prácticas elegidas).
-- Antes de esta migración `cohorts` solo tenía fecha_inicio/fecha_fin, que
-- en la práctica ya delimitaban el curso; se renombran a *_curso y se
-- agregan las dos columnas de matrícula.

begin;

alter table cohorts rename column fecha_inicio to fecha_inicio_curso;
alter table cohorts rename column fecha_fin to fecha_fin_curso;

alter table cohorts
  add column fecha_inicio_matricula date,
  add column fecha_fin_matricula date;

-- Backfill de la cohorte existente (TA-23001, curso 2026-08-01 a
-- 2026-09-04, ya cerrada): se le asigna una ventana de matrícula también
-- ya vencida, anterior y sin solape con la ventana de curso.
update cohorts
set fecha_inicio_matricula = '2026-07-01',
    fecha_fin_matricula = '2026-07-25'
where fecha_inicio_matricula is null;

alter table cohorts
  alter column fecha_inicio_matricula set not null,
  alter column fecha_fin_matricula set not null;

-- Metadata opcional, puramente informativa (refleja el oficio real de la
-- escuela a la ANT) — sin validación asociada.
alter table cohorts
  add column tipo_modalidad text,
  add column horarios_capacitacion_teoria text,
  add column numero_vehiculos integer,
  add column numero_aulas integer;

alter table cohorts drop constraint cohorts_fechas_validas;

alter table cohorts
  add constraint cohorts_fechas_curso_validas check (fecha_fin_curso >= fecha_inicio_curso);

alter table cohorts
  add constraint cohorts_fechas_matricula_validas
    check (fecha_fin_matricula >= fecha_inicio_matricula);

comment on column cohorts.fecha_inicio_matricula is
  'Inicio de la ventana en la que se puede inscribir gente en esta cohorte.';
comment on column cohorts.fecha_fin_matricula is
  'Fin de la ventana de matrícula. Es el plazo real que se comunica al estudiante para entregar documentos físicos completos.';
comment on column cohorts.fecha_inicio_curso is
  'Inicio de la ventana dentro de la cual deben caber todas las prácticas elegidas.';
comment on column cohorts.fecha_fin_curso is
  'Fin de la ventana de curso/prácticas.';
comment on column cohorts.tipo_modalidad is
  'Metadata informativa para el oficio a la ANT. Sin validación, no se usa en lógica de negocio.';
comment on column cohorts.horarios_capacitacion_teoria is
  'Metadata informativa para el oficio a la ANT. Sin validación, no se usa en lógica de negocio.';
comment on column cohorts.numero_vehiculos is
  'Metadata informativa para el oficio a la ANT. Sin validación, no se usa en lógica de negocio.';
comment on column cohorts.numero_aulas is
  'Metadata informativa para el oficio a la ANT. Sin validación, no se usa en lógica de negocio.';

commit;
