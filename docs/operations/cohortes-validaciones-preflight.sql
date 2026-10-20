-- Preflight de 029 (cohortes: límites y nombre único). SOLO LECTURA.
-- Ejecutar en el SQL Editor antes de la migración. No modifica datos.
-- Las cohortes no contienen datos personales; P1 muestra su inventario
-- (sin alumnos) para confirmar cupos y fechas, que hoy no se conocen.
begin read only;

-- P1. Inventario de las cohortes (con curso y ocupación por estado).
select c.id, c.nombre, char_length(c.nombre) as largo_nombre, co.nombre as curso, co.tipo,
       c.precio, c.cupo_maximo,
       c.fecha_inicio_matricula, c.fecha_fin_matricula, c.fecha_inicio_curso, c.fecha_fin_curso,
       c.numero_vehiculos, c.numero_aulas,
       char_length(c.tipo_modalidad) as largo_modalidad,
       char_length(c.horarios_capacitacion_teoria) as largo_horarios_teoria,
       c.created_at, c.updated_at,
       (select count(*) from public.enrollments e where e.cohort_id = c.id and e.status = 'activo') as activos,
       (select count(*) from public.enrollments e where e.cohort_id = c.id) as matriculas_total,
       (select count(*) from public.practice_slots s where s.cohort_id = c.id) as franjas
from public.cohorts c join public.courses co on co.id = c.course_id
order by c.created_at;

-- P2. Nombres repetidos dentro del mismo curso (sin mayúsculas ni espacios
-- extremos). Vacío = el índice único se puede crear. Si hay filas, 029 aborta.
select course_id, lower(btrim(nombre)) as nombre_normalizado, count(*) as veces, array_agg(id) as ids
from public.cohorts
group by course_id, lower(btrim(nombre))
having count(*) > 1;

-- P3. Violaciones de las reglas nuevas. Cada fila es una violación; vacío = todo bien.
-- Las marcadas «aborta 029» impiden aplicar la migración; las «solo servidor»
-- no la impiden, pero esa cohorte no se podrá guardar desde el formulario
-- hasta corregir el valor.
select id, nombre, 'aborta 029: nombre vacío o de más de 100 caracteres' as regla from public.cohorts
  where char_length(btrim(nombre)) not between 1 and 100
union all select id, nombre, 'aborta 029: precio mayor a 9999.99' from public.cohorts
  where precio > 9999.99
union all select id, nombre, 'aborta 029: cupo mayor a 500' from public.cohorts
  where cupo_maximo > 500
union all select id, nombre, 'aborta 029: vehículos fuera de 0-100' from public.cohorts
  where numero_vehiculos not between 0 and 100
union all select id, nombre, 'aborta 029: aulas fuera de 0-100' from public.cohorts
  where numero_aulas not between 0 and 100
union all select id, nombre, 'aborta 029: el curso termina antes de que abra la matrícula' from public.cohorts
  where fecha_fin_curso < fecha_inicio_matricula
union all select id, nombre, 'solo servidor: alguna fecha a más de 5 años de hoy' from public.cohorts
  where greatest(fecha_inicio_matricula, fecha_fin_matricula, fecha_inicio_curso, fecha_fin_curso)
        > (current_date + interval '5 years')
union all select id, nombre, 'solo servidor: modalidad de más de 100 caracteres' from public.cohorts
  where char_length(tipo_modalidad) > 100
union all select id, nombre, 'solo servidor: horarios de teoría de más de 500 caracteres' from public.cohorts
  where char_length(horarios_capacitacion_teoria) > 500
union all select id, nombre, 'informativo: nombre con espacios extremos (se guardará recortado al editar)' from public.cohorts
  where nombre <> btrim(nombre);

-- P4. Cohortes con cupo menor que sus alumnos activos (informativo; F-02, lote L4b).
select c.id, c.nombre, c.cupo_maximo, count(e.id) as activos
from public.cohorts c left join public.enrollments e on e.cohort_id = c.id and e.status = 'activo'
group by c.id having count(e.id) > c.cupo_maximo;

-- P5. Restricciones e índices actuales de cohorts. Esperado ANTES de 029:
-- cohorts_aulas_rango, cohorts_cupo_maximo_rango, cohorts_curso_no_antes_matricula,
-- cohorts_nombre_longitud, cohorts_precio_maximo, cohorts_vehiculos_rango y el índice
-- cohorts_course_nombre_unique NO existen (si existen, 029 ya se aplicó: no repetir).
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint where conrelid = 'public.cohorts'::regclass order by conname;
select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'cohorts';
select count(*) as objetos_029_ya_presentes from (
  select conname as nombre from pg_constraint
    where conrelid = 'public.cohorts'::regclass and conname in (
      'cohorts_nombre_longitud', 'cohorts_precio_maximo', 'cohorts_cupo_maximo_rango',
      'cohorts_vehiculos_rango', 'cohorts_aulas_rango', 'cohorts_curso_no_antes_matricula')
  union all
  select indexname from pg_indexes
    where schemaname = 'public' and indexname = 'cohorts_course_nombre_unique'
) o;
-- Los mínimos que 029 conserva deben existir (esperado 4).
select count(*) as minimos_existentes from pg_constraint
  where conrelid = 'public.cohorts'::regclass and conname in (
    'cohorts_precio_non_negative', 'cohorts_cupo_positive',
    'cohorts_fechas_curso_validas', 'cohorts_fechas_matricula_validas');

-- P6. Lo que referencia a cohorts y con qué acción de borrado (informativo, lote L6b).
select conrelid::regclass as tabla, conname, pg_get_constraintdef(oid) as definicion
from pg_constraint where confrelid = 'public.cohorts'::regclass order by 1, 2;

-- P7. Filas de student_practice_recovery cuyo cohort_id no existe (informativo, F-11/L6b).
select count(*) as huerfanas from public.student_practice_recovery r
where not exists (select 1 from public.cohorts c where c.id = r.cohort_id);

rollback;
