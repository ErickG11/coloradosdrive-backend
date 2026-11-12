begin;
update public.enrollment_rule_flags set enabled=false where key='waitlist';
commit;
