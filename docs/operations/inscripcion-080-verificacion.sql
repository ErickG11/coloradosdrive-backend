begin read only;
do $$begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Indicadores activados';end if;
 if exists(select 1 from public.users where identity_document_type='cedula' and identity_document_number is distinct from cedula or identity_document_type<>'cedula' and cedula is not null) then raise exception 'Documento incoherente';end if;
 if exists(select identity_document_type,identity_document_number from public.users group by identity_document_type,identity_document_number having count(*)>1) then raise exception 'Documento duplicado';end if;
 if has_function_privilege('authenticated','public.find_manual_students_v2(uuid,text)','EXECUTE') then raise exception 'Búsqueda expuesta';end if;
end $$;
select identity_document_type,count(*) from public.users group by identity_document_type;
select entity_type,count(*) from public.enrollment_domain_audit where action='identity_backfill_080' group by entity_type;
rollback;
