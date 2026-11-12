begin read only;
do $$begin
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Indicadores activados';end if;
 if has_function_privilege('authenticated','public.revoke_request_approval_v2(uuid,uuid,timestamptz,text)','EXECUTE') then raise exception 'RPC expuesta';end if;
 if exists(select 1 from public.solicitud_verificaciones where mode='presencial' and scan_path is null) then raise exception 'Falta escaneo';end if;
 if exists(select 1 from public.solicitudes_inscripcion s left join public.enrollments e on e.id=s.linked_enrollment_id where s.estado='archivada' and(s.student_id is null or s.archived_at is null or e.student_id is distinct from s.student_id)) then raise exception 'Archivo sin vínculo';end if;
end $$;
select estado,count(*),count(*) filter(where revoked_at is not null) as revocadas from public.solicitudes_inscripcion group by estado;
rollback;
