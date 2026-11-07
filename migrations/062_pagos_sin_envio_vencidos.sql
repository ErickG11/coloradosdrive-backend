-- I10/H7. MANUAL después de061. No cancela pagos enviados; sin UPDATE masivo de datos.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regclass('public.payments') is null or to_regclass('public.payment_events') is null then raise exception '062 requiere060';end if;
 if to_regprocedure('public.expire_student_reservations(uuid)') is null or(select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.expire_student_reservations(uuid)')) not in ('c23d3626d244212fea9a653ed14976e2','dee7f7a6bd097bd1b62b49467981e3db') then raise exception '062: falta función o cuerpo distinto: public.expire_student_reservations(uuid)';end if;
 if to_regprocedure('public.claim_payment_dispatch(uuid)') is null or(select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.claim_payment_dispatch(uuid)')) not in ('a3e64350ec06e5e4aa297e8e5e025c8d','a123a4d21df49fa7ddb374d5d182d225') then raise exception '062: falta función o cuerpo distinto: public.claim_payment_dispatch(uuid)';end if;
end $$;
create or replace function public.expire_student_reservations(p_student uuid) returns integer
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r record;p record;v_hash text;n integer:=0;begin
 perform 1 from public.users where id=p_student and rol='estudiante' for update;
 if not found then return 0;end if;
 perform 1 from public.enrollments where student_id=p_student order by id for update;
 for r in select id from public.student_schedule_reservations where student_id=p_student
 and estado in ('vigente','pago_en_curso') and expira_at<=clock_timestamp() order by id for update loop
 perform private.close_student_reservation(r.id,'vencida');n:=n+1;end loop;
 -- Solo intentos sin salida al proveedor pueden caducar localmente. La misma fila
 -- serializa con claim_payment_dispatch; no cancelar después de dispatch_at.
 for p in update public.payments pay set estado='rechazado',motivo_revision='NO_ENVIADO_VENCIDO',updated_at=clock_timestamp()
 from public.student_schedule_reservations res where pay.reservation_id=res.id and pay.student_id=p_student
 and pay.estado='pendiente' and pay.dispatch_at is null and pay.proveedor in ('simulado','kushki')
 and(res.expira_at<=clock_timestamp() or res.estado in ('liberada','vencida')) returning pay.id,pay.proveedor loop
 v_hash:=encode(sha256(convert_to('pago_no_enviado_vencido:'||p.id::text,'UTF8')),'hex');
 insert into public.payment_events(payment_id,proveedor,event_key,body_hash,resultado)
 values(p.id,p.proveedor,v_hash,v_hash,'rechazado') on conflict(proveedor,event_key) do nothing;
 end loop;
 return n;
end $$;
create or replace function public.claim_payment_dispatch(p_id uuid) returns boolean
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare p public.payments;r public.student_schedule_reservations;v_student uuid;begin
 select student_id into v_student from public.payments where id=p_id;
 if not found or v_student is null then return false;end if;
 perform 1 from public.users where id=v_student and rol='estudiante' and activo and status in ('verificado','activo') for update;
 if not found then return false;end if;
 perform private.assert_student_not_deleting(v_student);
 perform 1 from public.enrollments where student_id=v_student order by id for update;
 perform public.expire_student_reservations(v_student);
 select * into r from public.student_schedule_reservations where id=(select reservation_id from public.payments where id=p_id) for update;
 select * into p from public.payments where id=p_id for update;
 if p.estado<>'pendiente' or p.dispatch_at is not null then return false;end if;
 if r.id is null or r.estado<>'pago_en_curso' or r.expira_at<=clock_timestamp()
 or not exists(select 1 from public.enrollments where id=p.enrollment_id and student_id=v_student
  and origen='solicitud' and etapa_inscripcion='reservado' and status='pendiente_cohorte' and cohort_id=r.cohort_id)
 or exists(select 1 from public.student_schedule_holds where reservation_id=r.id and scheduled_at<=clock_timestamp()) then
 if r.id is not null and r.estado in ('vigente','pago_en_curso') then perform private.close_student_reservation(r.id,'vencida');end if;
 perform public.expire_student_reservations(v_student);
 return false;end if;
 update public.payments set dispatch_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p.id and estado='pendiente' and dispatch_at is null;
 return found;
end $$;
revoke all on function public.expire_student_reservations(uuid),public.claim_payment_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.expire_student_reservations(uuid),public.claim_payment_dispatch(uuid) to service_role;
notify pgrst,'reload schema';
commit;
