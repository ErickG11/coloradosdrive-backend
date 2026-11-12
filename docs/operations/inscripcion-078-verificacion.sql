begin read only;
do $$begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Indicadores activados';end if;
 if has_function_privilege('authenticated','public.claim_billing_v2()','EXECUTE') then raise exception 'Cola expuesta';end if;
 if exists(select payment_id from public.billing_documents where kind='invoice' group by payment_id having count(*)>1) then raise exception 'Factura duplicada';end if;
 if exists(select 1 from public.billing_documents b join public.payments p on p.id=b.payment_id where b.kind='invoice' and(b.amount_centavos<>p.total_centavos or p.estado<>'aprobado')) then raise exception 'Importe o estado no coincidente';end if;
end $$;
select kind,state,count(*),sum(amount_centavos) from public.billing_documents group by kind,state;
rollback;
