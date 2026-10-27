-- Rollback manual. Detener E4 antes; no descartar auditoria utilizada.
begin;
set local lock_timeout = '5s';
lock table public.practice_attendance_events in access exclusive mode;
do $$ begin
  if exists(select 1 from public.practice_attendance_events)
    or exists(select 1 from public.notifications where tipo = 'asistencia_corregida') then
    raise exception 'No se puede revertir 034: existen eventos de asistencia; preparar correccion de avance';
  end if;
end $$;
drop trigger practice_slots_attendance_audit on public.practice_slots;
drop function public.register_practice_attendance(uuid,uuid,boolean);
drop function public.correct_practice_attendance(uuid,uuid,boolean,text);
drop function public.list_practice_attendance_events(uuid,uuid,integer,integer);
drop function public.student_practice_history(uuid,uuid,integer,integer);
drop function private.write_practice_attendance(uuid,uuid,boolean,boolean,text);
drop function private.attendance_correction_window_open(timestamptz,integer,timestamptz);
drop function private.enqueue_attendance_correction(uuid);
drop function private.require_attendance_event();
alter table public.notifications drop constraint notifications_attendance_event_check;
drop index public.notifications_attendance_event_unique;
alter table public.notifications drop column attendance_event_id;
alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check check (tipo in (
  'recordatorio_practica', 'resultado_cancelacion', 'cupo_disponible', 'sin_practica_instructor', 'cambio_realizado'));
drop index public.notifications_automatic_unique;
create unique index notifications_automatic_unique on public.notifications(user_id, tipo, practice_slot_id)
  where practice_slot_id is not null;
create or replace function private.enqueue_practice_notification(
  p_user uuid, p_type text, p_title text, p_message text, p_slot uuid,
  p_scheduled_at timestamptz, p_email boolean default false
) returns void language sql volatile security invoker set search_path = '' as $$
  insert into public.notifications(user_id, tipo, titulo, mensaje, practice_slot_id, scheduled_at, email_status)
  select u.id, p_type, p_title, p_message, p_slot, p_scheduled_at,
    case when p_email then 'pendiente' else null end
  from public.users u where u.id = p_user and u.activo and u.rol in ('estudiante', 'instructor')
  on conflict (user_id, tipo, practice_slot_id) where practice_slot_id is not null do nothing;
$$;
drop table public.practice_attendance_events;
drop function private.trim_attendance_reason(text);
drop function private.reject_attendance_event_mutation();
commit;
