begin read only;
-- Requiere 039. Resolver resultados antes de aplicar.
select to_regclass('public.solicitudes_inscripcion'),to_regclass('public.solicitud_documentos'),to_regclass('public.notifications');
select student_id,count(*) from public.solicitudes_inscripcion where student_id is not null group by student_id having count(*)>1;
select id from public.solicitudes_inscripcion where estado='pendiente_revision' and reviewed_at is not null;
rollback;
