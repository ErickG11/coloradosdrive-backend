-- 028 / SOLO LECTURA. Erick debe revisar todos los resultados antes de ejecutar la migración.
-- Se espera UTF8; normalize() requiere una base UTF8.
show server_encoding;
select current_setting('server_version') as postgres_version;
select to_regprocedure('public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)') as rpc_023,
  to_regprocedure('public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamp with time zone,date)') as rpc_027;
-- Confirmar tablas y RLS tal como están; 028 no modifica ninguna política ni tabla.
select c.relname,c.relrowsecurity,c.relforcerowsecurity,
  has_table_privilege('service_role',c.oid,'SELECT') as service_role_select
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('users','enrollments','enrollment_documents','cohorts','exams','exam_attempts','practice_slots')
order by c.relname;
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and (
  (table_name='users' and column_name in ('rol','activo','nombre_completo','cedula','telefono')) or
  (table_name='enrollments' and column_name in ('student_id','course_id','cohort_id','status','monto_total','monto_abonado','horas_practica_objetivo')) or
  (table_name='enrollment_documents' and column_name in ('enrollment_id','tipo','estado')) or
  (table_name='cohorts' and column_name in ('nombre','cupo_maximo')) or
  (table_name='exams' and column_name in ('course_id','type','is_published')) or
  (table_name='exam_attempts' and column_name in ('student_id','exam_id','status','passed')) or
  (table_name='practice_slots' and column_name in ('student_id','cohort_id','status','attended','duration_minutes')))
order by table_name,column_name;
-- Antes: ambas nuevas funciones deben ser NULL. Después: service_role=true y el resto=false.
select to_regprocedure('public.student_search_key(text)') as search_helper_028,
  to_regprocedure('public.student_requirements(jsonb)') as requirements_helper_028;
select r.rolname,p.proname,p.prosecdef,
  has_function_privilege(r.rolname,p.oid,'EXECUTE') as can_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
cross join pg_catalog.pg_roles r where n.nspname='public'
  and p.proname in ('list_admin_students','student_search_key','student_requirements')
  and r.rolname in ('anon','authenticated','service_role') order by p.proname,r.rolname;
-- Solo agregados: no expone datos de alumnos. NULL no se interpretará como práctica completa.
select count(*) as matriculas_sin_objetivo from public.enrollments
  where status in ('activo','pendiente_cohorte') and horas_practica_objetivo is null;
select count(*) as matriculas_con_saldo_sin_vencimientos from public.enrollments
  where status in ('activo','pendiente_cohorte') and (monto_total is null or monto_abonado<monto_total);
