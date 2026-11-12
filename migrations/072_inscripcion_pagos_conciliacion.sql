-- L3. Confirmación idempotente sin revalidar cierre ni precio actual. Cola de conciliación por puerto.
begin;
set local lock_timeout='5s';
alter table public.app_settings add column if not exists conciliacion_intervalo_minutos integer not null default 15 check(conciliacion_intervalo_minutos>0),
 add column if not exists conciliacion_ventana_horas integer not null default 24 check(conciliacion_ventana_horas>0),
 add column if not exists pago_tardio_politica text not null default 'revision' check(pago_tardio_politica in ('revision','equivalente','devolucion_documentada'));
alter table public.payments add column if not exists reconciliation_checked_at timestamptz,
 add column if not exists reconciliation_attempts integer not null default 0,
 add column if not exists reconciliation_next_at timestamptz,
 add column if not exists reconciliation_token uuid,
 add column if not exists reconciliation_lease_until timestamptz,
 add column if not exists reconciliation_result text;
create index if not exists payments_reconciliation_pending on public.payments(reconciliation_next_at,created_at,id) where estado='pendiente';

create or replace function private.begin_payment_v2(p_student uuid,p_reserva uuid,p_proveedor text,p_attempt uuid,
 p_recargo integer,p_actor uuid,p_comprobante text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.student_schedule_reservations;e public.enrollments;p public.payments;v jsonb;begin
 if p_attempt is null or p_proveedor not in ('simulado','manual','kushki') or p_recargo is null or p_recargo<0
  or length(coalesce(p_comprobante,''))>160 then perform private.raise_cohort_error('PAGO_ENTRADA_INVALIDA');end if;
 if p_proveedor='manual' and not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then
  perform private.raise_cohort_error('PERMISO_REQUERIDO');end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo and status in ('verificado','activo') for update;
 if not found then perform private.raise_cohort_error('PAGO_CUENTA_NO_HABILITADA');end if;
 perform 1 from public.enrollments where student_id=p_student order by id for update;
 select * into p from public.payments where attempt_key=p_attempt;
 if found then
  if p.student_id is distinct from p_student or p.reservation_id is distinct from p_reserva or p.proveedor<>p_proveedor then
    perform private.raise_cohort_error('PAGO_IDEMPOTENCIA_CONFLICTO');end if;
  return private.payment_json(p.id);
 end if;
 perform private.expire_reservations_v2(p_student);
 select * into r from public.student_schedule_reservations where id=p_reserva and student_id=p_student for update;
 if not found then perform private.raise_cohort_error('PAGO_RESERVA_NO_ENCONTRADA');end if;
 select * into e from public.enrollments where id=r.enrollment_id;
 if r.estado<>'vigente' or r.expira_at<=private.cohortes_now() or e.etapa_inscripcion<>'reservado'
   or e.requisitos_verificados_at is null then perform private.raise_cohort_error('PAGO_RESERVA_INVALIDA');end if;
 if r.precio_snapshot_centavos is null or r.precio_snapshot_source<>'reservation_creation' then
   perform private.raise_cohort_error('PAGO_PRECIO_NO_CONFIGURADO');end if;
 if exists(select 1 from public.payments where enrollment_id=e.id and estado in ('pendiente','aprobado','revision')) then
   perform private.raise_cohort_error('PAGO_INTENTO_PENDIENTE');end if;
 v:=private.manage_reservation_v2(p_student,'iniciar_pago',r.id);
 if v->>'estado'<>'pago_en_curso' then perform private.raise_cohort_error('PAGO_RESERVA_INVALIDA');end if;
 insert into public.payments(student_id,enrollment_id,reservation_id,attempt_key,proveedor,subtotal_centavos,
  recargo_centavos,total_centavos,actor_id,comprobante,reconciliation_next_at)
 values(p_student,e.id,r.id,p_attempt,p_proveedor,r.precio_snapshot_centavos,p_recargo,
  r.precio_snapshot_centavos+p_recargo,p_actor,nullif(btrim(p_comprobante),''),private.cohortes_now()+interval '15 minutes') returning * into p;
 return private.payment_json(p.id);
end $$;

create or replace function private.claim_dispatch_v2(p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p public.payments;r public.student_schedule_reservations;sid uuid;begin
 select student_id into sid from public.payments where id=p_id;
 perform 1 from public.users where id=sid and rol='estudiante' and activo for update;
 if not found then perform private.raise_cohort_error('PAGO_CUENTA_NO_HABILITADA');end if;
 perform 1 from public.enrollments where student_id=sid order by id for update;
 select * into r from public.student_schedule_reservations where id=(select reservation_id from public.payments where id=p_id) for update;
 select * into p from public.payments where id=p_id for update;
 if p.id is null then perform private.raise_cohort_error('PAGO_NO_ENCONTRADO');end if;
 if p.estado<>'pendiente' or p.dispatch_at is not null then return false;end if;
 if r.estado<>'pago_en_curso' or not exists(select 1 from public.student_schedule_holds where reservation_id=r.id and released_at is null and payment_protected)
  or exists(select 1 from public.student_schedule_holds where reservation_id=r.id and scheduled_at<=private.cohortes_now()) then
  perform private.raise_cohort_error('PAGO_RESERVA_INVALIDA');end if;
 update public.payments set dispatch_at=private.cohortes_now(),updated_at=private.cohortes_now() where id=p.id;
 return true;
end $$;

create or replace function private.confirm_payment_v2(p_id uuid,p_proveedor text,p_referencia text,p_resultado text,
 p_total bigint,p_moneda text,p_event text,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.payments;r public.student_schedule_reservations;e public.enrollments;event public.payment_events;
 sid uuid;ref text;reason text;h record;instructor uuid;chosen_slot uuid;v_state text;begin
 if p_resultado is null or p_resultado not in ('pendiente','rechazado','aprobado') or p_total is null or p_total<0
  or p_event is null or p_event !~ '^[a-f0-9]{64}$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
  or p_proveedor is null or p_proveedor not in ('simulado','manual','kushki')
  or (p_referencia is null and not(p_proveedor='kushki' and p_resultado='rechazado')) then
  perform private.raise_cohort_error('PAGO_ENTRADA_INVALIDA');end if;
 select student_id into sid from public.payments where id=p_id;
 if not found then perform private.raise_cohort_error('PAGO_NO_ENCONTRADO');end if;
 perform 1 from public.users where id=sid for update;
 perform 1 from public.enrollments where student_id=sid order by id for update;
 select * into r from public.student_schedule_reservations where id=(select reservation_id from public.payments where id=p_id) for update;
 select * into p from public.payments where id=p_id for update;
 ref:=coalesce(p_referencia,p.referencia,'kushki-rechazado:'||p.id::text);
 if p.proveedor<>p_proveedor or(p.referencia is not null and p.referencia<>ref and p.referencia not like 'kushki-rechazado:%') then
  perform private.raise_cohort_error('PAGO_REFERENCIA_CONFLICTO');end if;
 select * into event from public.payment_events where proveedor=p_proveedor and event_key=p_event;
 if found then
  if event.payment_id<>p.id or event.body_hash<>p_hash or event.resultado<>p_resultado then
   perform private.raise_cohort_error('PAGO_IDEMPOTENCIA_CONFLICTO');end if;
  return private.payment_json(p.id);
 end if;
 insert into public.payment_events(payment_id,proveedor,event_key,body_hash,resultado) values(p.id,p_proveedor,p_event,p_hash,p_resultado);
 if p.estado='aprobado' and p_total=p.total_centavos and p_moneda=p.moneda then return private.payment_json(p.id);end if;
 update public.payments set referencia=ref,recibido_centavos=p_total,recibido_moneda=p_moneda,updated_at=private.cohortes_now() where id=p.id;
 if p_resultado='pendiente' then return private.payment_json(p.id);end if;
 if p.estado='revision' then return private.payment_json(p.id);end if;
 if p_resultado='rechazado' then
  if p.estado='aprobado' then return private.payment_json(p.id);end if;
  update public.payments set estado='rechazado' where id=p.id;
  update public.student_schedule_holds set payment_protected=false where reservation_id=r.id;
  update public.student_schedule_reservations set estado='vigente' where id=r.id and estado='pago_en_curso';
  perform private.expire_reservations_v2(sid);
  return private.payment_json(p.id);
 end if;
 if p_total<>p.total_centavos or p_moneda is distinct from p.moneda then reason:='PAGO_MONTO_NO_COINCIDE';end if;
 if reason is null then begin
  if not exists(select 1 from public.users where id=sid and rol='estudiante' and activo and status in ('activo','verificado')) then
    perform private.raise_cohort_error('PAGO_CUENTA_NO_HABILITADA');end if;
  select * into e from public.enrollments where id=p.enrollment_id and student_id=sid;
  if e.id is null or e.requisitos_verificados_at is null or e.etapa_inscripcion<>'reservado'
   or r.estado<>'pago_en_curso' or r.admission_at is null or r.admission_at>r.creada_at
   or r.precio_snapshot_centavos is distinct from p.subtotal_centavos then
    perform private.raise_cohort_error('PAGO_APROBADO_SIN_RECURSOS');end if;
  perform 1 from public.cohorts where id=r.cohort_id for update;
  perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
  if (select count(*) from public.student_schedule_holds where reservation_id=r.id and released_at is null and payment_protected)<>15
   or exists(select 1 from public.student_schedule_holds where reservation_id=r.id and scheduled_at<=private.cohortes_now()) then
    perform private.raise_cohort_error('PAGO_APROBADO_SIN_RECURSOS');end if;
  update public.student_schedule_holds set released_at=private.cohortes_now(),payment_protected=false where reservation_id=r.id;
  update public.users set status='activo' where id=sid and status='verificado';
  update public.enrollments set etapa_inscripcion='activa',status='activo',reserva_expira_at=null,
   monto_total=p.total_centavos::numeric/100,monto_abonado=p.total_centavos::numeric/100,paid_amount_centavos=p.total_centavos,
   practice_start_date=r.practice_start_date,practice_end_date=r.practice_end_date,access_end_date=r.practice_end_date,
   individual_dates_source='reservation_holds',horas_practica_objetivo=15 where id=e.id;
  for h in select * from public.student_schedule_holds where reservation_id=r.id order by scheduled_at loop
   select id into instructor from private.free_instructors_v2(array[h.scheduled_at],sid,r.id)
     order by (id=h.instructor_id) desc limit 1;
   if instructor is null then perform private.raise_cohort_error('PAGO_APROBADO_SIN_RECURSOS');end if;
   select id into chosen_slot from public.practice_slots where instructor_id=instructor and scheduled_at=h.scheduled_at
     and student_id is null and status in ('disponible','liberado') order by id limit 1 for update;
   if chosen_slot is not null then
    update public.practice_slots set student_id=sid,cohort_id=r.cohort_id,status='asignado' where id=chosen_slot;
   else
    insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status)
     values(r.cohort_id,instructor,sid,h.scheduled_at,60,'asignado');
   end if;
  end loop;
  update public.student_schedule_reservations set estado='confirmada',cerrada_at=private.cohortes_now() where id=r.id;
  insert into public.student_schedule_events(reservation_id,accion) values(r.id,'confirmada');
 exception when others then
  get stacked diagnostics v_state=returned_sqlstate;
  reason:=case when v_state='P7000' then 'PAGO_APROBADO_SIN_RECURSOS' else 'PAGO_ACTIVACION_REVISION' end;
 end;end if;
 if reason is not null then
  update public.payments set estado='revision',motivo_revision=reason,confirmed_at=private.cohortes_now() where id=p.id;
  insert into public.notifications(user_id,tipo,titulo,mensaje)
   select id,'cambio_realizado','Pago recibido: revisión necesaria','Hay un pago recibido que necesita revisión. No realices otro pago.'
    from public.users where id=sid;
  insert into public.notifications(user_id,tipo,titulo,mensaje)
   select id,'cambio_realizado','Pago requiere revisión','Revisar pago '||p.id::text||': '||reason
    from public.users u where rol='admin' and activo and exists(select 1 from public.enrollment_admin_permissions a where a.admin_id=u.id and a.permission='view_payments_invoices' and a.revoked_at is null);
 else
  update public.payments set estado='aprobado',confirmed_at=private.cohortes_now() where id=p.id;
  insert into public.payment_mail_outbox(payment_id) values(p.id) on conflict do nothing;
 end if;
 return private.payment_json(p.id);
end $$;

alter function public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text) set schema private;
alter function private.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text) rename to legacy072_begin_student_payment;
create function public.begin_student_payment(p_student uuid,p_reserva uuid,p_proveedor text,p_attempt uuid,p_recargo integer default 0,
 p_gracia integer default 10,p_actor uuid default null,p_comprobante text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$ begin
 if not exists(select 1 from public.student_schedule_reservations where id=p_reserva and admission_rule_version='070') then return private.legacy072_begin_student_payment(p_student,p_reserva,p_proveedor,p_attempt,p_recargo,p_gracia,p_actor,p_comprobante);end if;
 return private.begin_payment_v2(p_student,p_reserva,p_proveedor,p_attempt,p_recargo,p_actor,p_comprobante);
end $$;
alter function public.claim_payment_dispatch(uuid) set schema private;
alter function private.claim_payment_dispatch(uuid) rename to legacy072_claim_payment_dispatch;
create function public.claim_payment_dispatch(p_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$ begin
 if not exists(select 1 from public.payments p join public.student_schedule_reservations r on r.id=p.reservation_id where p.id=p_id and r.admission_rule_version='070') then return private.legacy072_claim_payment_dispatch(p_id);end if;
 return private.claim_dispatch_v2(p_id);
end $$;
alter function public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text) set schema private;
alter function private.confirm_student_payment(uuid,text,text,text,bigint,text,text,text) rename to legacy072_confirm_student_payment;
create function public.confirm_student_payment(p_id uuid,p_proveedor text,p_referencia text,p_resultado text,p_total bigint,p_moneda text,p_event text,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 if not exists(select 1 from public.payments p join public.student_schedule_reservations r on r.id=p.reservation_id where p.id=p_id and r.admission_rule_version='070') then return private.legacy072_confirm_student_payment(p_id,p_proveedor,p_referencia,p_resultado,p_total,p_moneda,p_event,p_hash);end if;
 return private.confirm_payment_v2(p_id,p_proveedor,p_referencia,p_resultado,p_total,p_moneda,p_event,p_hash);
end $$;
-- El puerto de consulta externa puede declarar NO_OPERATIVA; jamás supone un cobro.
-- La lease persiste en payments y permite varias réplicas del trabajo periódico.
alter table public.notifications add column if not exists domain_code text,
 add column if not exists domain_entity_id uuid,add column if not exists domain_severity text,
 add column if not exists domain_last_seen_at timestamptz,add column if not exists domain_resolved_at timestamptz;
create unique index if not exists notifications_domain_open on public.notifications(user_id,domain_code,domain_entity_id)
 where domain_code is not null and domain_resolved_at is null;
create or replace function private.payment_alert_v2(p_code text,p_payment uuid,p_message text,p_resolved boolean default false)
returns void language plpgsql security invoker set search_path='' as $$ begin
 if p_resolved then update public.notifications set domain_resolved_at=clock_timestamp()
  where domain_code=p_code and domain_entity_id=p_payment and domain_resolved_at is null;return;end if;
 insert into public.notifications(user_id,tipo,titulo,mensaje,domain_code,domain_entity_id,domain_severity,domain_last_seen_at)
 select u.id,'cambio_realizado',p_code,p_message,p_code,p_payment,'alta',clock_timestamp()
 from public.users u join public.enrollment_admin_permissions a on a.admin_id=u.id and a.permission='view_payments_invoices' and a.revoked_at is null
 where u.rol='admin' and u.activo
 on conflict(user_id,domain_code,domain_entity_id) where domain_code is not null and domain_resolved_at is null
 do update set domain_last_seen_at=excluded.domain_last_seen_at,
 read_at=case when public.notifications.domain_last_seen_at<clock_timestamp()-interval '1 day' then null else public.notifications.read_at end;
end $$;
create or replace function public.claim_payment_reconciliation() returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.payments;token uuid:=gen_random_uuid();cfg public.app_settings;begin
 if not private.enrollment_rule_enabled('payments') then return null;end if;
 select * into cfg from public.app_settings where id;
 select pay.* into p from public.payments pay join public.student_schedule_reservations r on r.id=pay.reservation_id
 where r.admission_rule_version='070' and pay.estado in ('pendiente','revision') and pay.proveedor='kushki'
 and pay.created_at>=clock_timestamp()-make_interval(hours=>cfg.conciliacion_ventana_horas)
 and coalesce(pay.reconciliation_next_at,pay.created_at+make_interval(mins=>cfg.conciliacion_intervalo_minutos))<=clock_timestamp()
 and(pay.reconciliation_lease_until is null or pay.reconciliation_lease_until<=clock_timestamp())
 order by pay.created_at,pay.id for update of pay skip locked limit 1;
 if not found then return null;end if;
 update public.payments set reconciliation_token=token,reconciliation_lease_until=clock_timestamp()+interval '2 minutes' where id=p.id;
 return jsonb_build_object('id',p.id,'token',token,'reference',p.referencia,'dispatched',p.dispatch_at is not null);
end $$;
create or replace function public.finish_payment_reconciliation(p_id uuid,p_token uuid,p_result text) returns boolean
language plpgsql security invoker set search_path='' as $$ declare p public.payments;mins integer;begin
 if p_result not in ('NO_OPERATIVA','CONSULTA_FALLIDA','INCIERTO','RESUELTO') then perform private.raise_cohort_error('PAGO_ENTRADA_INVALIDA');end if;
 select * into p from public.payments where id=p_id for update;
 if not found or p.reconciliation_token is distinct from p_token or p.reconciliation_lease_until<=clock_timestamp() then return false;end if;
 select conciliacion_intervalo_minutos into mins from public.app_settings where id;
 update public.payments set reconciliation_checked_at=clock_timestamp(),reconciliation_attempts=reconciliation_attempts+1,
 reconciliation_next_at=clock_timestamp()+make_interval(mins=>mins),reconciliation_token=null,reconciliation_lease_until=null,reconciliation_result=p_result where id=p_id;
 perform private.payment_alert_v2('PAGO_CONCILIACION_NO_OPERATIVA',p_id,'Consulta de Kushki no disponible. Revisar el pago y su referencia en el proveedor antes de resolver.',p_result='RESUELTO');
 if p.dispatch_at is not null then perform private.payment_alert_v2('PAGO_DESPACHADO_INCIERTO',p_id,'El intento fue despachado y sigue sin resultado definitivo. No liberar recursos ni repetir el cobro.',p_result='RESUELTO');end if;
 return true;
end $$;
revoke all on function private.payment_alert_v2(text,uuid,text,boolean),public.claim_payment_reconciliation(),public.finish_payment_reconciliation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.payment_alert_v2(text,uuid,text,boolean),public.claim_payment_reconciliation(),public.finish_payment_reconciliation(uuid,uuid,text) to service_role;
grant update(domain_code,domain_entity_id,domain_severity,domain_last_seen_at,domain_resolved_at) on public.notifications to service_role;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where(n.nspname='private' and(p.proname in ('begin_payment_v2','claim_dispatch_v2','confirm_payment_v2') or p.proname like 'legacy072_%'))
   or(n.nspname='public' and p.proname in ('begin_student_payment','claim_payment_dispatch','confirm_student_payment')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
update public.enrollment_rule_flags set implemented=true,enabled=false where key='payments';
notify pgrst,'reload schema';
commit;
