begin read only;
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Indicadores activados';end if;
 if to_regclass('public.notifications_waitlist_event') is null then raise exception 'Deduplicación ausente';end if;
 if has_function_privilege('authenticated','public.enqueue_waitlist_event_v2(uuid,uuid)','EXECUTE') then raise exception 'RPC expuesta';end if;
end $$;
rollback;
