begin read only;
do $$ declare t text; r text; begin
 foreach t in array array['public.course_type_prices','public.enrollment_rule_flags',
   'public.enrollment_plan_options','public.enrollment_admin_permissions','public.enrollment_domain_audit',
   'public.enrollment_funnel_events','private.enrollment_backfill_069'] loop
   if not (select relrowsecurity from pg_class where oid=t::regclass) then raise exception 'RLS ausente: %',t;end if;
   foreach r in array array['anon','authenticated'] loop
     if has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Tabla expuesta: % a %',t,r;end if;
   end loop;
   if has_table_privilege('service_role',t,'INSERT,UPDATE,DELETE') then raise exception 'Escritura no autorizada en lote 1: %',t;end if;
 end loop;
 if (select count(*) from public.enrollment_rule_flags)<>14
   or exists(select 1 from public.enrollment_rule_flags where enabled or implemented) then
   raise exception 'Indicadores no preparados o activados';end if;
 if (select count(*) from public.enrollment_plan_options)<>12
   or exists(select 1 from public.enrollment_plan_options where horas_objetivo<>15)
   or not exists(select 1 from public.enrollment_plan_options where modalidad='fin_de_semana' and horas_por_dia=1 and not habilitada) then
   raise exception 'Configuración de modalidades incorrecta';end if;
 if exists(select 1 from public.enrollments where individual_dates_guard_ready) then raise exception 'Guard activado antes de lote 5';end if;
end $$;
rollback;
