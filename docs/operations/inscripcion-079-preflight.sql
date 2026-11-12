begin read only;
select key,implemented,enabled from public.enrollment_rule_flags order by key;
-- Exportar aprobaciones sin vínculo demostrable y reclamaciones abiertas; sin inventar fechas.
select s.id,s.student_id,s.estado,s.reviewed_at,count(e.id) as candidate_enrollments,array_agg(e.id) filter(where e.id is not null) as evidence
 from public.solicitudes_inscripcion s left join public.enrollments e on e.student_id=s.student_id and e.course_id=s.course_id and e.origen='solicitud'
 where s.estado='aprobada' group by s.id,s.student_id,s.estado,s.reviewed_at;
select * from private.lote1_preflight_cases;
rollback;
