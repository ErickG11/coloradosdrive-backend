-- L8. Puerto fiscal pendiente: persistencia y cola manual, sin emisión simulada.
begin;
set local lock_timeout='5s';
alter table public.app_settings add column if not exists billing_activated_at timestamptz,
 add column if not exists billing_retry_alert_after integer not null default 3 check(billing_retry_alert_after between 1 and 100);
alter table public.users add column if not exists billing_profile jsonb;
create table if not exists public.billing_documents (
 id uuid primary key default gen_random_uuid(),payment_id uuid not null references public.payments(id) on delete restrict,
 student_id uuid not null references public.users(id) on delete restrict,kind text not null check(kind in('invoice','credit_note')),
 parent_id uuid references public.billing_documents(id) on delete restrict,refund_key uuid unique,
 amount_centavos bigint not null check(amount_centavos>=0),currency text not null default 'USD' check(currency='USD'),
 payer jsonb,state text not null default 'queued' check(state in('queued','processing','manual_pending','failed','issued')),
 attempts integer not null default 0,lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz default clock_timestamp(),
 access_key text unique check(access_key is null or access_key ~ '^[0-9]{49}$'),authorization_code text,
 authorized_at timestamptz,provider_ruc text check(provider_ruc is null or provider_ruc ~ '^[0-9]{13}$'),
 last_error_code text,documented_reason text,documented_reference text,documented_by uuid,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((kind='invoice' and parent_id is null and refund_key is null) or(kind='credit_note' and parent_id is not null and refund_key is not null)),
 check(state<>'issued' or(access_key is not null and authorization_code is not null and authorized_at is not null and provider_ruc is not null))
);
create unique index if not exists billing_invoice_payment on public.billing_documents(payment_id) where kind='invoice';
create index if not exists billing_queue on public.billing_documents(next_attempt_at,id) where state in('queued','processing','failed');
alter table public.billing_documents enable row level security;
revoke all on public.billing_documents from public,anon,authenticated;
grant select,insert,update on public.billing_documents to service_role;
grant select(billing_profile),update(billing_profile) on public.users to service_role;

create or replace function private.billing_activation_v2() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.key='billing' and new.enabled and not old.enabled then
  update public.app_settings set billing_activated_at=coalesce(billing_activated_at,private.cohortes_now()) where id;
  if not found then insert into public.app_settings(id,billing_activated_at) values(true,private.cohortes_now());end if;
 end if;return new;
end $$;
drop trigger if exists billing_activation on public.enrollment_rule_flags;
create trigger billing_activation after update on public.enrollment_rule_flags for each row execute function private.billing_activation_v2();

create or replace function private.assert_billing_profile_v2(p jsonb) returns void language plpgsql security invoker set search_path='' as $$begin
 if p is null or jsonb_typeof(p)<>'object' or not (p ?& array['name','documentType','documentNumber','address','email'])
  or exists(select 1 from jsonb_object_keys(p) k where k not in('name','documentType','documentNumber','address','email'))
  or exists(select 1 from jsonb_each(p) e where jsonb_typeof(e.value)<>'string')
  or length(btrim(p->>'name')) not between 2 and 200 or length(btrim(p->>'address')) not between 2 and 300
  or p->>'documentType' not in('ruc','cedula','pasaporte','otro')
  or coalesce(p->>'documentNumber','') !~ '^[A-Za-z0-9-]{3,30}$'
  or length(p->>'email')>254 or coalesce(p->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then perform private.raise_cohort_error('FACTURA_DATOS_INVALIDOS');end if;
end $$;
create or replace function private.enqueue_invoice_v2(p_payment uuid) returns void language plpgsql security invoker set search_path='' as $$
declare p public.payments;cutoff timestamptz;begin
 if not private.enrollment_rule_enabled('billing') then return;end if;
 select billing_activated_at into cutoff from public.app_settings where id;
 select * into p from public.payments where id=p_payment;
 if p.estado<>'aprobado' or p.created_at<cutoff or cutoff is null or p.student_id is null then return;end if;
 insert into public.billing_documents(payment_id,student_id,kind,amount_centavos,payer)
 select p.id,p.student_id,'invoice',p.total_centavos,u.billing_profile from public.users u where u.id=p.student_id
 on conflict(payment_id) where kind='invoice' do nothing;
 perform private.payment_alert_v2('FACTURA_ENCOLADO_FALLIDO',p.id,'Factura recuperada en cola.',true);
end $$;
create or replace function private.payment_invoice_event_v2() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.estado='aprobado' then begin
  perform private.enqueue_invoice_v2(new.id);
 exception when others then begin
  perform private.payment_alert_v2('FACTURA_ENCOLADO_FALLIDO',new.id,'Pago conservado. Revisar la recuperación de la cola fiscal.');
 exception when others then null;end;end;end if;return new;
end $$;
drop trigger if exists payments_invoice_event on public.payments;
create trigger payments_invoice_event after insert or update of estado on public.payments for each row execute function private.payment_invoice_event_v2();

create or replace function public.billing_state_v2(p_student uuid,p_actor uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if p_actor is not null then perform private.require_enrollment_permission(p_actor,'view_payments_invoices');end if;
 if not exists(select 1 from public.users where id=p_student and rol='estudiante' and(p_actor is not null or activo)) then perform private.raise_cohort_error('FACTURA_ALUMNO_NO_ENCONTRADO');end if;
 if not private.enrollment_rule_enabled('billing') then return jsonb_build_object('active',false);end if;
 return jsonb_build_object('active',true,'profile',(select billing_profile from public.users where id=p_student),'serverNow',private.cohortes_now(),
  'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'paymentId',d.payment_id,'kind',d.kind,'state',d.state,'amountCentavos',d.amount_centavos,'attempts',d.attempts,
  'accessKey',d.access_key,'authorization',d.authorization_code,'authorizedAt',d.authorized_at,'providerRuc',d.provider_ruc,'lastErrorCode',d.last_error_code,'updatedAt',d.updated_at) order by d.created_at,d.id) from public.billing_documents d where d.student_id=p_student),'[]'::jsonb));
end $$;
create or replace function public.save_billing_profile_v2(p_student uuid,p_profile jsonb,p_actor uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if p_actor is not null then perform private.require_enrollment_permission(p_actor,'view_payments_invoices');end if;
 if not private.enrollment_rule_enabled('billing') then perform private.raise_cohort_error('FACTURA_REGLAS_INACTIVAS');end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and(p_actor is not null or activo) for update;
 if not found then perform private.raise_cohort_error('FACTURA_ALUMNO_NO_ENCONTRADO');end if;
 perform private.assert_billing_profile_v2(p_profile);
 update public.users set billing_profile=p_profile where id=p_student;
 -- El emisor no procesa una copia antigua mientras se corrigen datos.
 if exists(select 1 from public.billing_documents where student_id=p_student and state='processing' and lease_until>private.cohortes_now()) then perform private.raise_cohort_error('FACTURA_EN_PROCESO');end if;
 update public.billing_documents set payer=p_profile,updated_at=clock_timestamp() where student_id=p_student and state<>'issued';
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,reason) values(coalesce(p_actor,p_student),'billing_profile_updated','student',p_student::text,'Datos de facturación actualizados; contenido omitido');
 return public.billing_state_v2(p_student,p_actor);
end $$;
create or replace function public.claim_billing_v2() returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.billing_documents;p record;begin
 if not private.enrollment_rule_enabled('billing') then return null;end if;
 -- Recuperación de fallos de encolado sin incluir pagos históricos.
 for p in select id from public.payments where estado='aprobado' and created_at>=(select billing_activated_at from public.app_settings where id)
  and not exists(select 1 from public.billing_documents b where b.payment_id=payments.id and b.kind='invoice') order by created_at,id limit 50 loop
  begin perform private.enqueue_invoice_v2(p.id);exception when others then perform private.payment_alert_v2('FACTURA_ENCOLADO_FALLIDO',p.id,'Revisar pago aprobado sin factura en cola. La matrícula se conserva.');end;
 end loop;
 select * into d from public.billing_documents where (state in('queued','failed') and next_attempt_at<=private.cohortes_now() or state='processing' and lease_until<=private.cohortes_now())
 and attempts<(select billing_retry_alert_after from public.app_settings where id) order by created_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update public.billing_documents set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=private.cohortes_now()+interval '5 minutes',updated_at=clock_timestamp() where id=d.id returning * into d;
 return jsonb_build_object('id',d.id,'paymentId',d.payment_id,'kind',d.kind,'amountCentavos',d.amount_centavos,'payer',d.payer,'leaseToken',d.lease_token,'idempotencyKey',d.id);
end $$;
create or replace function public.finish_billing_v2(p_document uuid,p_token uuid,p_result text) returns boolean language plpgsql security invoker set search_path='' as $$declare d public.billing_documents;threshold integer;begin
 select * into d from public.billing_documents where id=p_document for update;
 if d.id is null or d.state<>'processing' or d.lease_token is distinct from p_token or d.lease_until<=private.cohortes_now() then perform private.raise_cohort_error('FACTURA_LEASE_INVALIDO');end if;
 if p_result not in('MANUAL_PENDING','FAILED') or p_result is null then perform private.raise_cohort_error('FACTURA_RESULTADO_INVALIDO');end if;
 select billing_retry_alert_after into threshold from public.app_settings where id;
 update public.billing_documents set state=case when p_result='MANUAL_PENDING' then 'manual_pending' else 'failed' end,
 lease_token=null,lease_until=null,next_attempt_at=private.cohortes_now()+interval '15 minutes',last_error_code=case when p_result='FAILED' then 'FACTURA_EMISION_FALLIDA' else 'FACTURA_PROVEEDOR_PENDIENTE' end,updated_at=clock_timestamp() where id=d.id;
 if d.attempts>=threshold or p_result='MANUAL_PENDING' then perform private.payment_alert_v2('FACTURA_PENDIENTE',d.id,'Pagado, factura pendiente. Revisar datos y completar emisión fiscal por el canal autorizado.');end if;
 return true;
end $$;
create or replace function public.admin_billing_action_v2(p_actor uuid,p_document uuid,p_version timestamptz,p_action text,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.billing_documents;authorized_instant timestamptz;begin
 perform private.require_enrollment_permission(p_actor,'view_payments_invoices');
 if not private.enrollment_rule_enabled('billing') then perform private.raise_cohort_error('FACTURA_REGLAS_INACTIVAS');end if;
 select * into d from public.billing_documents where id=p_document for update;
 if not found then perform private.raise_cohort_error('FACTURA_NO_ENCONTRADA');end if;
 if d.updated_at is distinct from p_version then perform private.raise_cohort_error('FACTURA_VERSION_CONFLICTO');end if;
 if d.state='issued' then
  if p_action='record_authorization' and d.access_key=p_data->>'accessKey' and d.authorization_code=p_data->>'authorization' and d.provider_ruc=p_data->>'providerRuc' then return public.billing_state_v2(d.student_id,p_actor);end if;
  perform private.raise_cohort_error('FACTURA_YA_EMITIDA');end if;
 if d.state='processing' and d.lease_until>private.cohortes_now() then perform private.raise_cohort_error('FACTURA_EN_PROCESO');end if;
 if p_action='retry' then
  update public.billing_documents set state='queued',attempts=0,next_attempt_at=private.cohortes_now(),lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=d.id;
 elsif p_action='record_authorization' then
  perform private.assert_billing_profile_v2(d.payer);
  begin authorized_instant:=(p_data->>'authorizedAt')::timestamptz;exception when others then perform private.raise_cohort_error('FACTURA_AUTORIZACION_INVALIDA');end;
  if coalesce(p_data->>'accessKey','')!~'^[0-9]{49}$' or length(coalesce(p_data->>'authorization','')) not between 1 and 160
   or coalesce(p_data->>'providerRuc','')!~'^[0-9]{13}$' or p_data->>'authorizedAt' is null
   or authorized_instant>private.cohortes_now() or not isfinite(authorized_instant) then perform private.raise_cohort_error('FACTURA_AUTORIZACION_INVALIDA');end if;
  update public.billing_documents set state='issued',access_key=p_data->>'accessKey',authorization_code=p_data->>'authorization',provider_ruc=p_data->>'providerRuc',authorized_at=authorized_instant,
   lease_token=null,lease_until=null,last_error_code=null,updated_at=clock_timestamp() where id=d.id;
  perform private.payment_alert_v2('FACTURA_PENDIENTE',d.id,'Autorización fiscal registrada.',true);
 else perform private.raise_cohort_error('FACTURA_RESULTADO_INVALIDO');end if;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,reason) values(p_actor,'billing_'||p_action,'billing_document',d.id::text,'Operación fiscal administrativa; contenido omitido');
 return public.billing_state_v2(d.student_id,p_actor);
end $$;
create or replace function public.document_refund_v2(p_actor uuid,p_payment uuid,p_key uuid,p_amount bigint,p_reason text,p_reference text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.billing_documents;d public.billing_documents;begin
 perform private.require_enrollment_permission(p_actor,'view_payments_invoices');
 if not private.enrollment_rule_enabled('billing') then perform private.raise_cohort_error('FACTURA_REGLAS_INACTIVAS');end if;
 select * into inv from public.billing_documents where payment_id=p_payment and kind='invoice' for update;
 if not found then perform private.raise_cohort_error('FACTURA_NO_ENCONTRADA');end if;
 select * into d from public.billing_documents where refund_key=p_key;
 if found then if d.payment_id<>p_payment or d.amount_centavos<>p_amount or d.documented_reason is distinct from btrim(p_reason) or d.documented_reference is distinct from btrim(p_reference) then perform private.raise_cohort_error('FACTURA_IDEMPOTENCIA_CONFLICTO');end if;return public.billing_state_v2(inv.student_id,p_actor);end if;
 if inv.state<>'issued' or p_key is null or p_amount is null or p_amount<=0 or length(btrim(coalesce(p_reason,''))) not between 1 and 500 or length(btrim(coalesce(p_reference,''))) not between 1 and 160
  or p_amount+coalesce((select sum(amount_centavos) from public.billing_documents where parent_id=inv.id),0)>inv.amount_centavos then perform private.raise_cohort_error('FACTURA_DEVOLUCION_INVALIDA');end if;
 insert into public.billing_documents(payment_id,student_id,kind,parent_id,refund_key,amount_centavos,payer,documented_reason,documented_reference,documented_by)
 values(p_payment,inv.student_id,'credit_note',inv.id,p_key,p_amount,inv.payer,btrim(p_reason),btrim(p_reference),p_actor);
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason) values(p_actor,'refund_documented','payment',p_payment::text,jsonb_build_object('amountCentavos',p_amount,'refundKey',p_key),btrim(p_reason));
 return public.billing_state_v2(inv.student_id,p_actor);
end $$;
-- Solo backend de confianza; sujeto/actor derivado del JWT, nunca del cuerpo alumno.
do $$declare r record;begin for r in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='public' and p.proname in('billing_state_v2','save_billing_profile_v2','claim_billing_v2','finish_billing_v2','admin_billing_action_v2','document_refund_v2'))
 or(n.nspname='private' and p.proname in('billing_activation_v2','assert_billing_profile_v2','enqueue_invoice_v2','payment_invoice_event_v2')) loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',r.nspname,r.proname,r.args);
 execute format('grant execute on function %I.%I(%s) to service_role',r.nspname,r.proname,r.args);end loop;end $$;
update public.enrollment_rule_flags set implemented=true,enabled=false where key='billing';
notify pgrst,'reload schema';
commit;
