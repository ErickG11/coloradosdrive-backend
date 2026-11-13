begin;
set local role service_role;
select current_user;
select id,student_id,'Sin contrato demostrable; requiere revisión' motivo from public.enrollments where status='activo' and (practice_plan is null or not(practice_plan ?& array['fechaFinElegida','modalidad','horasPorDia']));
do $$begin if not has_function_privilege('service_role','private.write_practice_contract_v14()','EXECUTE') or (select prosecdef from pg_proc where oid='private.write_practice_contract_v14()'::regprocedure) then raise exception 'VERIFICACION_088: seguridad incorrecta de private.write_practice_contract_v14()';end if;end $$;
do $$begin if not has_function_privilege('service_role','private.resolve_practice_contract_v14(enrollments)','EXECUTE') or (select prosecdef from pg_proc where oid='private.resolve_practice_contract_v14(enrollments)'::regprocedure) then raise exception 'VERIFICACION_088: seguridad incorrecta de private.resolve_practice_contract_v14(enrollments)';end if;end $$;
rollback;
