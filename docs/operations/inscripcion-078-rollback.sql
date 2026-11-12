begin;
set local lock_timeout='5s';
do $$begin
 if exists(select 1 from public.enrollment_rule_flags where enabled or(key in('identity','foreign_identity','permissions','metrics') and implemented)) then raise exception 'Apagar indicadores y revertir lotes posteriores';end if;
 if exists(select 1 from public.billing_documents where state='processing' and lease_until>private.cohortes_now()) then raise exception 'Esperar leases fiscales';end if;
end $$;
drop trigger payments_invoice_event on public.payments;
drop trigger billing_activation on public.enrollment_rule_flags;
drop function public.document_refund_v2(uuid,uuid,uuid,bigint,text,text);
drop function public.admin_billing_action_v2(uuid,uuid,timestamptz,text,jsonb);
drop function public.save_billing_profile_v2(uuid,jsonb,uuid);
drop function public.billing_state_v2(uuid,uuid);
drop function public.claim_billing_v2();
drop function public.finish_billing_v2(uuid,uuid,text);
-- Conserva documentos fiscales, corte de activación, datos y auditoría; no vuelve histórica la cola.
update public.enrollment_rule_flags set enabled=false,implemented=false where key='billing';
notify pgrst,'reload schema';
commit;
