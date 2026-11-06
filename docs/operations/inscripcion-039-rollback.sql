-- Retirar antes endpoints/job dependientes. Las eliminaciones no son reversibles.
begin;
drop function if exists public.eliminar_solicitud_reclamada(uuid,timestamptz,uuid,text);
commit;
