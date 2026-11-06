begin read only;
select to_regclass('public.solicitud_auditoria'),to_regprocedure('public.guard_solicitud_edit()');
-- Requiere 037 y 038. No eliminar la auditoría al retirar un expediente.
rollback;
