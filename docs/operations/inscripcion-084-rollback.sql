begin;
update public.enrollment_rule_flags set enabled=false where key in('identity','schedule_changes','cohort_admin');
commit;
