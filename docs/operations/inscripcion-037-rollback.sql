-- Retirar primero la versión de aplicación que depende de 037.
-- Exportar consentimientos antes: este rollback elimina esos registros.
begin;
set local lock_timeout='5s';
drop trigger if exists solicitudes_fecha_inmutable on public.solicitudes_inscripcion;
drop function if exists public.protect_solicitud_date();
drop table if exists public.solicitud_consentimientos;
-- Conservar auditoría para no perder trazabilidad; su retirada requiere decisión explícita.
alter table public.solicitud_documentos drop column if exists reviewed_by;
alter table public.solicitudes_inscripcion drop column if exists solicitada_at;
commit;
