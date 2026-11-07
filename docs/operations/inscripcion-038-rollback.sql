begin;
drop trigger if exists solicitud_documentos_edit_guard on public.solicitud_documentos;
drop trigger if exists solicitud_consentimientos_edit_guard on public.solicitud_consentimientos;
drop function if exists public.guard_solicitud_edit();
drop function if exists public.finalizar_aprobacion_solicitud(uuid,uuid,timestamptz,uuid,uuid);
commit;
