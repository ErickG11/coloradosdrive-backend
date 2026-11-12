begin read only;
select key,enabled,implemented from public.enrollment_rule_flags order by key;
select practicas_hora_fin from public.app_settings where id;
select e.admin_id,e.permission from public.enrollment_admin_permissions e join public.users u on u.id=e.admin_id where u.rol='admin' order by 1,2;
select indexdef from pg_indexes where tablename='enrollments';
rollback;
