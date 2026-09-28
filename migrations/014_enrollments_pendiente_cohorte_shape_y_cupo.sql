-- 014_enrollments_pendiente_cohorte_shape_y_cupo.sql
-- Fase 3: permite crear un enrollment sin cohorte asignada todavía
-- (status = 'pendiente_cohorte'), y hace cumplir cohorts.cupo_maximo con
-- protección real contra condición de carrera.

begin;

alter table enrollments
  alter column cohort_id drop not null,
  alter column monto_total drop not null;

-- Invariante de forma: pendiente_cohorte <=> sin cohorte ni monto (no hay
-- cohorte de la que copiar el precio); para cualquier otro estado, ambos
-- son obligatorios como hasta ahora.
alter table enrollments
  add constraint enrollments_pendiente_cohorte_shape check (
    (status = 'pendiente_cohorte' and cohort_id is null and monto_total is null)
    or
    (status <> 'pendiente_cohorte' and cohort_id is not null and monto_total is not null)
  );

-- 'pendiente_cohorte' también cuenta como "no terminal": un estudiante no
-- puede tener una inscripción pendiente de cohorte Y otra activa a la vez.
drop index enrollments_one_active_per_student;
create unique index enrollments_one_active_per_student
  on enrollments (student_id)
  where status in ('activo', 'pendiente_cohorte');

comment on index enrollments_one_active_per_student is
  'Un estudiante solo puede tener UNA inscripción no terminal (activo o pendiente_cohorte) a la vez.';

-- ---------------------------------------------------------------------
-- Enforcement de cupo_maximo con lock explícito por cohorte.
--
-- Un COUNT(*) sin lock tiene condición de carrera: dos transacciones
-- concurrentes pueden contar el mismo número de cupos ocupados (por debajo
-- del máximo) y ambas pasar, superando cupo_maximo. Aquí no basta un
-- índice único (a diferencia de practice_slots, donde "una franja, un
-- estudiante" sí es una combinación irrepetible) porque el límite es un
-- conteo, no una tupla.
--
-- La solución es un lock de fila explícito: SELECT ... FOR UPDATE sobre la
-- fila de la cohorte específica en cohorts. La primera transacción que
-- llega toma el lock, cuenta, inserta y libera el lock al hacer commit. La
-- segunda transacción concurrente que compite por el mismo cupo se
-- bloquea en el FOR UPDATE hasta que la primera termine; al reanudar, su
-- propio COUNT(*) ya ve la fila recién commiteada de la primera, por lo
-- que si el cupo se agotó, falla de forma determinística. Otras cohortes
-- no se ven afectadas: el lock es por fila, no por tabla.
create function enforce_cohort_cupo()
returns trigger
language plpgsql
as $$
declare
  v_cupo integer;
  v_ocupados integer;
begin
  -- Una fila pendiente_cohorte (cohort_id null) o que no queda 'activo'
  -- (finalizado/retirado) no consume cupo de ninguna cohorte.
  if NEW.cohort_id is null or NEW.status <> 'activo' then
    return NEW;
  end if;

  -- En UPDATE, si ni cohort_id ni status cambiaron, no hay nada que
  -- reverificar (evita re-lockear/recontar en cada UPDATE no relacionado).
  if TG_OP = 'UPDATE'
     and NEW.cohort_id is not distinct from OLD.cohort_id
     and NEW.status is not distinct from OLD.status then
    return NEW;
  end if;

  select cupo_maximo into v_cupo
  from cohorts
  where id = NEW.cohort_id
  for update;

  if not found then
    raise exception 'La cohorte % no existe', NEW.cohort_id;
  end if;

  select count(*) into v_ocupados
  from enrollments
  where cohort_id = NEW.cohort_id
    and status = 'activo'
    and id <> NEW.id;

  if v_ocupados >= v_cupo then
    -- Código de error propio (no colisiona con ningún SQLSTATE estándar
    -- de Postgres) para que la capa de aplicación lo distinga de
    -- cualquier otra violación de constraint y lo traduzca a un 409 claro.
    raise exception 'La cohorte % ya alcanzó su cupo máximo (%)', NEW.cohort_id, v_cupo
      using errcode = 'CD001';
  end if;

  return NEW;
end;
$$;

comment on function enforce_cohort_cupo() is
  'Hace cumplir cohorts.cupo_maximo contando enrollments activos de esa cohorte bajo un lock de fila (SELECT ... FOR UPDATE) sobre la cohorte, para que dos inserts/updates concurrentes por el último cupo no puedan pasar ambos.';

create trigger enrollments_enforce_cupo
  before insert or update of cohort_id, status on enrollments
  for each row
  execute function enforce_cohort_cupo();

commit;
