-- MANUAL: restaura funciones060/059; conserva todos los intentos/eventos.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regclass('public.payments') is null or to_regclass('public.payment_events') is null then raise exception '062 requiere060';end if;
 if to_regprocedure('public.expire_student_reservations(uuid)') is null or(select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.expire_student_reservations(uuid)')) not in ('c23d3626d244212fea9a653ed14976e2','dee7f7a6bd097bd1b62b49467981e3db') then raise exception '062: falta función o cuerpo distinto: public.expire_student_reservations(uuid)';end if;
 if to_regprocedure('public.claim_payment_dispatch(uuid)') is null or(select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.claim_payment_dispatch(uuid)')) not in ('a3e64350ec06e5e4aa297e8e5e025c8d','a123a4d21df49fa7ddb374d5d182d225') then raise exception '062: falta función o cuerpo distinto: public.claim_payment_dispatch(uuid)';end if;
end $$;
create or replace function public.expire_student_reservations(p_student uuid) returns integer
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r record;n integer:=0;begin
 perform 1 from public.users where id=p_student and rol='estudiante' for update;
 if not found then return 0;end if;
 perform 1 from public.enrollments where student_id=p_student order by id for update;
 for r in select id from public.student_schedule_reservations where student_id=p_student
 and estado in ('vigente','pago_en_curso') and expira_at<=clock_timestamp() order by id for update loop
 perform private.close_student_reservation(r.id,'vencida');n:=n+1;end loop;
 return n;
end $$;
create or replace function public.claim_payment_dispatch(p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$ begin
 update public.payments set dispatch_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_id and estado='pendiente' and dispatch_at is null;
 return found;
end $$;
revoke all on function public.expire_student_reservations(uuid),public.claim_payment_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.expire_student_reservations(uuid),public.claim_payment_dispatch(uuid) to service_role;
notify pgrst,'reload schema';
commit;
