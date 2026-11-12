begin;
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled or (implemented and key<>'date_rules')) then
  raise exception 'Revertir primero lotes posteriores y apagar indicadores';end if;
end $$;
drop function if exists private.assert_enrollment_plan_future(jsonb,timestamptz);
drop function if exists private.enrollment_plan_v2(jsonb);
drop function if exists private.cohort_calendar_v2(date,date,date,date,boolean,timestamptz);
drop function if exists private.enrollment_rule_enabled(text);
drop function if exists private.raise_cohort_error(text,jsonb);
update public.enrollment_rule_flags set implemented=false,enabled=false where key='date_rules';
commit;
