begin read only;
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Indicadores activados durante migración';end if;
 if has_function_privilege('authenticated','public.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer)','EXECUTE') then raise exception 'RPC de reserva expuesta';end if;
 if has_function_privilege('anon','public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text)','EXECUTE') then raise exception 'RPC de pago expuesta';end if;
end $$;
rollback;
