-- Reversión de A1; no borra datos de usuarios, matrículas ni auditoría.
begin;
set local lock_timeout='5s';
drop function public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer);
drop function public.student_enrollment_is_current(public.enrollment_status);
drop index public.students_admin_order_idx, public.students_admin_active_order_idx,
  public.enrollments_student_history_idx, public.enrollments_current_filters_idx;
notify pgrst,'reload schema';
commit;
