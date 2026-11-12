begin read only;
select regexp_replace(normalize(lower(btrim(nombre)),NFD),U&'[\0300-\036f]','','g') normalized_name,array_agg(id order by id) ids
 from public.cohorts group by 1 having count(*)>1;
select id,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso from public.cohorts
 where fecha_fin_matricula>fecha_fin_curso or fecha_inicio_matricula>fecha_fin_matricula or fecha_inicio_curso>fecha_fin_curso;
select * from private.lote1_preflight_cases;
do $$ begin if exists(select 1 from public.enrollment_rule_flags where enabled) then raise exception 'Apagar indicadores';end if;end $$;
rollback;
