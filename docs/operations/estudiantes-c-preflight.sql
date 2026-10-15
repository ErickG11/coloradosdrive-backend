-- Solo lectura: devuelve conteos; no imprime perfiles, UUIDs ni definiciones.
begin read only;
select count(*) as funciones_reutilizadas,
  count(*) filter (where p.proname='enforce_cohort_cupo' and
    pg_get_functiondef(p.oid) like '%CD001%') as cupo_lanza_cd001,
  count(*) filter (where p.proname='assert_student_not_deleting' and
    pg_get_functiondef(p.oid) like '%CD030%') as guard_lanza_cd030
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname='enforce_cohort_cupo') or
      (n.nspname='private' and p.proname='assert_student_not_deleting');
select count(*) as pendientes,
  count(*) filter (where not u.activo) as alumnos_inactivos,
  count(*) filter (where exists(select 1 from public.student_deletion_operations d
    where d.student_id=e.student_id and d.status<>'completo')) as eliminacion_pendiente,
  count(*) filter (where e.cohort_id is not null or e.monto_total is not null or e.descuento<>0) as forma_invalida
from public.enrollments e join public.users u on u.id=e.student_id
where e.status='pendiente_cohorte';
select count(*) as cohortes,
  count(*) filter (where (select count(*) from public.enrollments e
    where e.cohort_id=c.id and e.status='activo')>c.cupo_maximo) as sobrecupo
from public.cohorts c;
select count(*) as triggers_requeridos_activos
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal and t.tgenabled in ('O','A')
  and ((c.relname='cohorts' and t.tgname='cohorts_set_updated_at') or
       (c.relname='enrollments' and t.tgname in
         ('enrollments_enforce_cupo','enrollments_00_resolve_course','enrollments_set_updated_at')));
select count(*) as fk_curso_cohorte
from pg_constraint where conrelid='public.enrollments'::regclass
  and conname='enrollments_cohort_course_fkey' and contype='f' and convalidated;
select count(*) as enrollments_rls_activo from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='enrollments' and c.relrowsecurity;
rollback;
