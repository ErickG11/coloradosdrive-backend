begin;
set local lock_timeout='5s';
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled or(implemented and key not in('date_rules','capacity','reservations','prices','payments','cohort_admin','enrollment_access','waitlist'))) then raise exception 'Apagar indicadores y revertir lotes posteriores';end if;
 if exists(select 1 from public.notifications where tipo='espera_apertura' and email_status='pendiente') then raise exception 'Resolver outbox de espera antes de revertir; no borrar correos ni marcas';end if;
end $$;
drop trigger notifications_waitlist_delivered on public.notifications;
drop function public.retry_waitlist_emails_v2(uuid,public.course_type,text);
drop function public.set_enrollment_waitlist_v2(uuid,public.course_type,jsonb,boolean);
drop function public.get_enrollment_waitlist_v2(uuid);
drop function public.preview_waitlist_event_v2(uuid,uuid);
drop function public.enqueue_waitlist_event_v2(uuid,uuid);
drop function public.admin_waitlist_counts_v2(uuid);
drop function public.list_admin_waitlist_students_v2(uuid,public.course_type,jsonb);
drop function public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer);
alter function private.legacy075_list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer) rename to list_admin_students;
alter function private.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer) set schema public;
-- Conserva marcas, notificaciones y columnas. No suprime historia ni envíos.
update public.enrollment_rule_flags set enabled=false,implemented=false where key='waitlist';
notify pgrst,'reload schema';
commit;
