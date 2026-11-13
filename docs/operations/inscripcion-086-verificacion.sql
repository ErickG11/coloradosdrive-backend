-- Comprobaciones sobre las funciones instaladas. No persiste cambios.
begin;
do $$declare h integer;definition text;begin
 select column_default into definition from information_schema.columns where table_schema='public' and table_name='enrollment_plan_options' and column_name='horas_objetivo';
 if definition is distinct from '10' then raise exception 'C08_DEFAULT: %',definition;end if;
 update public.enrollment_plan_options set horas_objetivo=10;
 delete from public.enrollment_plan_options where modalidad='entre_semana' and horas_por_dia=1;
 insert into public.enrollment_plan_options(modalidad,horas_por_dia,habilitada,motivo) values('entre_semana',1,true,'Plan de 10 horas, decisión del dueño 12/11/2026');
 if (select horas_objetivo from public.enrollment_plan_options where modalidad='entre_semana' and horas_por_dia=1)<>10 then raise exception 'C08_DEFAULT_INSERT';end if;
 foreach h in array array[0,-1] loop
 begin
 update public.enrollment_plan_options set horas_objetivo=h;
 raise exception 'C08_RESTRICCION: aceptó %',h;
 exception when check_violation then null;end;
 end loop;
end $$;
do $$declare p jsonb;r record;h integer;mode text;before_rows jsonb;after_rows jsonb;begin
 if (select count(*) from public.enrollment_plan_options)<>12 or exists(select 1 from public.enrollment_plan_options where horas_objetivo<>10 or habilitada is distinct from ((modalidad='entre_semana' and horas_por_dia in(1,2))or(modalidad='fin_de_semana' and horas_por_dia=2))) then raise exception 'C08_OFERTA';end if;
 if exists(select 1 from public.courses where tipo in('A','B') and horas_requeridas<>10) then raise exception 'C08_CURSOS';end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') into before_rows from public.enrollments e;
 for r in select * from(values
 ('entre_semana',1,'2026-11-16','2026-11-27',10,'["2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20","2026-11-23","2026-11-24","2026-11-25","2026-11-26","2026-11-27"]'::jsonb),
 ('entre_semana',2,'2026-11-16','2026-11-20',5,'["2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20"]'::jsonb),
 ('fin_de_semana',2,'2026-11-14','2026-11-28',5,'["2026-11-14","2026-11-15","2026-11-21","2026-11-22","2026-11-28"]'::jsonb),
 ('fin_de_semana',2,'2026-11-15','2026-11-29',5,'["2026-11-15","2026-11-21","2026-11-22","2026-11-28","2026-11-29"]'::jsonb),
 ('entre_semana',2,'2026-11-13','2026-11-19',5,'["2026-11-13","2026-11-16","2026-11-17","2026-11-18","2026-11-19"]'::jsonb),
 ('entre_semana',1,'2026-11-13','2026-11-26',10,'["2026-11-13","2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20","2026-11-23","2026-11-24","2026-11-25","2026-11-26"]'::jsonb)
 ) v(mode,hours,start_date,end_date,days,dates) loop
 p:=private.enrollment_plan_v2(jsonb_build_object('modalidad',r.mode,'horasPorDia',r.hours,'fechaInicio',r.start_date,'horaInicio',6));
 if (p->>'totalHoras')::int<>10 or jsonb_array_length(p->'franjas')<>10 or jsonb_array_length(p->'dias')<>r.days or p->>'ultimaFecha'<>r.end_date or (select jsonb_agg(d->'fecha') from jsonb_array_elements(p->'dias') d)<>r.dates then raise exception 'C08_PLAN: %',r;end if;
 end loop;
 foreach mode in array array['entre_semana','fin_de_semana'] loop
 for h in 1..6 loop
 if (mode='entre_semana' and h in(1,2))or(mode='fin_de_semana' and h=2) then continue;end if;
 begin
 perform private.enrollment_plan_v2(jsonb_build_object('modalidad',mode,'horasPorDia',h,'fechaInicio','2026-11-16','horaInicio',6));
 raise exception 'C08_OPCION_ACEPTADA: %, %',mode,h;
 exception when sqlstate 'P7000' then if sqlerrm<>'PLAN_ENTRADA_INVALIDA' then raise;end if;end;
 end loop;end loop;
 select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') into after_rows from public.enrollments e;
 if before_rows is distinct from after_rows then raise exception 'C08_HISTORICOS_MODIFICADOS';end if;
end $$;
select 'C08: oferta, fechas consecutivas, total de 10 y rechazos correctos' as resultado;
rollback;
