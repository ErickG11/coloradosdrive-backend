begin read only;
-- Verificación de instalación, no ejecuta escenarios de reserva ni cambia indicadores.
do $$begin
 if to_regprocedure('private.lock_student_schedule_v12(uuid)') is null then raise exception 'Falta candado de alumno';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 ((n.nspname='public' and p.proname in('commit_manual_enrollment','bulk_reassign_enrollments_v2')) or(n.nspname='private' and p.proname='integrated_manual_commit_v2')) and position('lock_student_schedule_v12' in p.prosrc)=0) then raise exception 'Falta candado temprano';end if;
end $$;
select key,enabled from public.enrollment_rule_flags order by key;
rollback;
