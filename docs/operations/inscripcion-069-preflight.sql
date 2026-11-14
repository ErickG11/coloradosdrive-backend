-- SOLO LECTURA tras 068, antes de 069. Exportable como CSV/JSON, sin nombres ni documentos.
begin read only;
select entity_type,entity_id,issue,evidence from private.lote1_preflight_cases order by entity_type,entity_id,issue;
select 'prices_pending' issue,t.tipo from (values('A'),('B')) t(tipo)
where not exists(select 1 from public.course_type_prices p where p.tipo::text=t.tipo);
select 'administrators_pending' issue,count(distinct admin_id) assigned_admins from public.enrollment_admin_permissions where revoked_at is null;
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception '069 requiere indicadores apagados';end if;
end $$;
rollback;
