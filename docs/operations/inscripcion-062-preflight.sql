-- Solo lectura antes de062.
begin;
do $$ begin
 if to_regclass('public.payments') is null or to_regclass('public.payment_events') is null then raise exception '062 requiere060';end if;
 if to_regprocedure('public.expire_student_reservations(uuid)') is null or(select md5(prosrc) from pg_proc where oid=to_regprocedure('public.expire_student_reservations(uuid)')) not in ('c23d3626d244212fea9a653ed14976e2','dee7f7a6bd097bd1b62b49467981e3db') then raise exception '062: falta función o cuerpo distinto: public.expire_student_reservations(uuid)';end if;
 if to_regprocedure('public.claim_payment_dispatch(uuid)') is null or(select md5(prosrc) from pg_proc where oid=to_regprocedure('public.claim_payment_dispatch(uuid)')) not in ('a3e64350ec06e5e4aa297e8e5e025c8d','a123a4d21df49fa7ddb374d5d182d225') then raise exception '062: falta función o cuerpo distinto: public.claim_payment_dispatch(uuid)';end if;
end $$;
select 'Caducar solo pendiente sin dispatch; validar lease/propiedad justo antes de enviar' as cambio;
rollback;
