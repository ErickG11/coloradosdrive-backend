-- Exportar las notificaciones nuevas antes de revertir. No se borran automáticamente.
begin;
do $$ begin if exists(select 1 from public.notifications where tipo in ('documento_aprobado','documento_rechazado')) then raise exception 'Hay notificaciones nuevas: exportar y resolver antes del rollback';end if;end $$;
drop function if exists public.revisar_documento_solicitud(uuid,uuid,uuid,text,text);
alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check check(tipo in ('recordatorio_practica','resultado_cancelacion','cupo_disponible','sin_practica_instructor','cambio_realizado','asistencia_corregida','encuesta_practica'));
commit;
