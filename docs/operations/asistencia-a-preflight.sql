-- SOLO LECTURA. Ejecutar antes de 030 y revisar los resultados con el responsable.
-- No corrige datos ni deduce planes desde las franjas o las fechas de la cohorte.
begin transaction read only;
select status, count(*) as franjas from public.practice_slots group by status order by status;
select count(*) as duraciones_distintas_de_60 from public.practice_slots where duration_minutes <> 60;

select 'instructor' as tipo, count(*) as cruces
from public.practice_slots a join public.practice_slots b on a.id < b.id and a.instructor_id = b.instructor_id
where a.status in ('disponible','asignado','confirmado','liberado','completado')
  and b.status in ('disponible','asignado','confirmado','liberado','completado')
  and tsrange(a.scheduled_at at time zone 'UTC', (a.scheduled_at at time zone 'UTC') + a.duration_minutes * interval '1 minute', '[)')
   && tsrange(b.scheduled_at at time zone 'UTC', (b.scheduled_at at time zone 'UTC') + b.duration_minutes * interval '1 minute', '[)')
union all
select 'alumno', count(*)
from public.practice_slots a join public.practice_slots b on a.id < b.id and a.student_id = b.student_id
where a.status in ('asignado','confirmado','completado') and b.status in ('asignado','confirmado','completado')
  and tsrange(a.scheduled_at at time zone 'UTC', (a.scheduled_at at time zone 'UTC') + a.duration_minutes * interval '1 minute', '[)')
   && tsrange(b.scheduled_at at time zone 'UTC', (b.scheduled_at at time zone 'UTC') + b.duration_minutes * interval '1 minute', '[)');

select status, count(*) as matriculas,
  count(*) filter (where practice_plan is null) as plan_nulo,
  count(*) filter (where nullif(btrim(practice_plan->>'fechaFinElegida'),'') is null) as fecha_fin_nula,
  count(*) filter (where not coalesce(
    (practice_plan->>'fechaFinElegida') ~ '^\d{4}-\d{2}-\d{2}$'
    and pg_input_is_valid(practice_plan->>'fechaFinElegida', 'date'), false)) as fecha_fin_invalida,
  count(*) filter (where not coalesce(practice_plan->>'modalidad' in ('entre_semana','fin_de_semana'), false)) as modalidad_invalida
from public.enrollments group by status order by status;

-- IDs para revisión; sin datos personales ni motivos libres.
select e.id as enrollment_id, e.status, e.practice_plan->>'fechaFinElegida' as fecha_fin,
  e.practice_plan->>'modalidad' as modalidad
from public.enrollments e
where e.practice_plan is null or not coalesce(
  (e.practice_plan->>'fechaFinElegida') ~ '^\d{4}-\d{2}-\d{2}$'
  and pg_input_is_valid(e.practice_plan->>'fechaFinElegida', 'date')
  and e.practice_plan->>'modalidad' in ('entre_semana','fin_de_semana'), false);

select count(*) as asignadas_futuras from public.practice_slots
where status = 'asignado' and scheduled_at > clock_timestamp();
select s.id, s.cohort_id, s.scheduled_at,
  (s.scheduled_at at time zone 'America/Guayaquil') as inicio_escuela
from public.practice_slots s where s.status = 'asignado' and s.scheduled_at > clock_timestamp()
order by s.scheduled_at;

-- Una práctica futura debe poder atribuirse a exactamente una matrícula activa.
select s.id as slot_id, count(e.id) as matriculas_activas
from public.practice_slots s left join public.enrollments e
  on e.student_id=s.student_id and e.cohort_id=s.cohort_id and e.status='activo'
where s.status in ('asignado','confirmado') and s.scheduled_at > clock_timestamp()
group by s.id having count(e.id) <> 1;

select to_regprocedure('private.book_practice_slot(uuid,uuid,text)') as reserva_025,
  to_regprocedure('public.delete_student_data(uuid,uuid,timestamp with time zone,text[])') as borrado_026,
  to_regprocedure('public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamp with time zone,date)') as cohorte_027;
select conname, convalidated from pg_constraint where conrelid='public.practice_slots'::regclass
  and conname in ('practice_slots_duration_60','practice_slots_instructor_interval_excl','practice_slots_student_interval_excl');
rollback;
