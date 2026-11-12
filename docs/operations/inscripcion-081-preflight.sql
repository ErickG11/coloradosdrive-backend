begin read only;
select key,enabled,implemented from public.enrollment_rule_flags order by key;
select id,rol,activo from public.users where rol='admin' order by id;
select student_id,course_type,count(*) from public.enrollments where status in('activo','pendiente_cohorte') group by student_id,course_type having count(*)>1;
rollback;
