begin read only;
do $$ declare p jsonb; c jsonb; r text;begin
 p:=private.enrollment_plan_v2('{"modalidad":"fin_de_semana","horasPorDia":1,"horaInicio":6,"fechaInicio":"2026-11-21"}');
 if p->>'ultimaFecha'<>'2027-01-09' or jsonb_array_length(p->'franjas')<>15 then raise exception '070 plan incorrecto';end if;
 c:=private.cohort_calendar_v2('2026-11-01','2026-11-15','2026-11-01','2026-11-30',true,'2026-11-11T04:59:59Z');
 if not(c->>'open')::boolean then raise exception '070 cierre adelantado';end if;
 c:=private.cohort_calendar_v2('2026-11-01','2026-11-15','2026-11-01','2026-11-30',true,'2026-11-11T05:00:00Z');
 if(c->>'open')::boolean then raise exception '070 cierre tardío';end if;
 foreach r in array array['anon','authenticated'] loop
  if has_function_privilege(r,'private.enrollment_plan_v2(jsonb)','EXECUTE') then raise exception '070 función interna expuesta';end if;
 end loop;
 if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception '070 activó indicadores';end if;
end $$;
rollback;
