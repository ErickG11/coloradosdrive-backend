begin read only;
select to_regclass('public.solicitud_consentimientos'),to_regclass('public.solicitud_auditoria'),to_regclass('public.enrollment_documents');
-- Aplicar 037 primero. Antes de desplegar, resolver cualquier aprobación anterior incompleta.
select id from public.solicitudes_inscripcion where estado='pendiente_revision' and reviewed_at is not null;
rollback;
