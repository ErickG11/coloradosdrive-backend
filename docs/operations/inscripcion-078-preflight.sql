begin read only;
-- Exportar estos resultados antes de aplicar. No se incorporan pagos históricos a la cola.
select id,estado,total_centavos,enrollment_id,student_id,created_at from public.payments where estado in('aprobado','revision','pendiente') order by created_at,id;
select key,enabled,implemented from public.enrollment_rule_flags order by key;
select jsonb_build_object('enrollmentId',id,'evidence',jsonb_build_object('practiceStart',practice_start_date,'practiceEnd',practice_end_date,'accessEnd',access_end_date),'source',individual_dates_source) as decision_required from public.enrollments where not individual_dates_guard_ready;
rollback;
