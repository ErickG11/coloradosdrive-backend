begin;
set local lock_timeout='5s';
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled or(implemented and key not in('date_rules','capacity','reservations','prices','payments','cohort_admin','enrollment_access'))) then raise exception 'Apagar indicadores y revertir lotes posteriores';end if;
 if exists(select 1 from public.enrollments where status in ('activo','pendiente_cohorte') group by student_id having count(*)>1) then raise exception 'Resolver convivencia A/B antes de restablecer índice global; sin borrar matrículas';end if;
end $$;
drop trigger enrollment_access_activation on public.enrollment_rule_flags;
drop trigger enrollments_00_current_guard on public.enrollments;
drop index public.enrollments_one_current_per_type;
create unique index if not exists enrollments_one_active_per_student on public.enrollments(student_id) where status in ('activo','pendiente_cohorte');
drop function private.content_student_eligible(uuid,uuid);
alter function private.legacy074_content_student_eligible(uuid,uuid) rename to content_student_eligible;
drop function public.admin_enrollment_access_v2(uuid,uuid);
drop function public.student_enrollment_access_v2(uuid);
drop function public.extend_enrollment_access_v2(uuid,uuid,date,text);
drop function public.authorize_repeat_enrollment_v2(uuid,uuid,uuid,text);
-- Conserva enum Anulada, columnas y forma ampliada: no reescribe ni borra historial.
update public.enrollment_rule_flags set enabled=false,implemented=false where key='enrollment_access';
notify pgrst,'reload schema';
commit;
