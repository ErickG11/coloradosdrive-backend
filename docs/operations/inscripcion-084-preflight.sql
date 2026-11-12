begin read only;
select id,student_id,practice_start_date,practice_end_date,individual_dates_source from public.enrollments where status='pendiente_cohorte' and(practice_start_date is null or practice_end_date is null);
rollback;
