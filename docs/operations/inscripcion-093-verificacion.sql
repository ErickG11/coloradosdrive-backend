begin;
do $$declare q text;begin
 select pg_get_expr(polqual,polrelid) into q from pg_policy where polrelid='realtime.messages'::regclass and polname='notifications_broadcast_v14';
 if q is null then raise exception 'VERIFICACION_093: falta la política notifications_broadcast_v14';end if;
 if q like '%public.users%' or q like '%users%' then raise exception 'VERIFICACION_093: la política consulta users directamente';end if;
 if q not like '%student_realtime_account_active%' or q not like '%-notifications%' or q not like '%broadcast%' then raise exception 'VERIFICACION_093: condición inesperada: %',q;end if;
 if (select polcmd from pg_policy where polrelid='realtime.messages'::regclass and polname='notifications_broadcast_v14')<>'r' then raise exception 'VERIFICACION_093: la política debe ser de lectura';end if;
 if not has_function_privilege('authenticated','private.student_realtime_account_active()','EXECUTE') then raise exception 'VERIFICACION_093: authenticated no ejecuta el helper';end if;
end $$;
rollback;
