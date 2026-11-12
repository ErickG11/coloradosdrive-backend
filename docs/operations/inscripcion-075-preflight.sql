begin read only;
select key,enabled,implemented from public.enrollment_rule_flags;
select count(*) pendientes_email from public.notifications where email_status='pendiente';
do $$ begin if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Apagar indicadores';end if;end $$;
rollback;
