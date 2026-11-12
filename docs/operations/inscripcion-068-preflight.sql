-- SOLO LECTURA: ejecutar antes de 068. Exportar los resultados en ubicación privada.
begin read only;
do $$ begin
 if to_regclass('public.enrollment_rule_flags') is not null then raise exception '068 ya presente o instalación parcial';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='image_path') then raise exception 'Falta 067';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='precio') then raise exception 'Posible 064 aplicada: detener';end if;
end $$;
select 'enrollments' entity,count(*) rows from public.enrollments union all
select 'reservations',count(*) from public.student_schedule_reservations union all
select 'payments',count(*) from public.payments;
select id enrollment_id,course_type,status,md5(coalesce(practice_plan::text,'null')) plan_hash,
 jsonb_typeof(practice_plan->'fechas') plan_dates_shape,
 exists(select 1 from public.student_schedule_reservations r where r.enrollment_id=e.id and r.estado='confirmada') confirmed_reservation
from public.enrollments e order by id;
select id cohort_id,'invalid_date_chain' issue from public.cohorts
where fecha_fin_matricula>fecha_fin_curso;
select student_id,course_type,count(*) from public.enrollments where status in ('activo','pendiente_cohorte')
group by student_id,course_type having count(*)>1;
rollback;
