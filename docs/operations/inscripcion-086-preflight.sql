-- Ejecutar después de 085 y antes de 086. Solo lectura.
begin read only;
do $guard$ declare g record;begin
 for g in select * from (values
  ('private.enrollment_plan_v2(jsonb)','275869129957f6cf838783efeeb98b6b'),
  ('private.reserve_schedule_v2(uuid,uuid,jsonb)','be937a1c439a4560074a33058cc44bad'),
  ('private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)','6e9505424bddc57b6b3dd5ae765db688'),
  ('private.mark_payment_dates_proven()','dfbfa45f06c15fca9ed374d339810ae3'),
  ('authorize_repeat_enrollment_v2(uuid,uuid,uuid,text)','2c32f1bf4c498d7545b3644f61df25ec'),
  ('private.reserve_plan_change_v2(uuid,uuid,jsonb,uuid,text,boolean,uuid)','8f2564cfd6ed9e03085745c53e13d8c0'),
  ('private.confirm_plan_change_v2(uuid,uuid,uuid)','910b76ac285d3652da3b4ededc8edd01'),
  ('private.integrated_manual_commit_v2(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamp with time zone[],uuid,jsonb,jsonb)','7a72553f201af934856b949e42fef9a9')
 ) v(sig,h) loop
  if to_regprocedure(g.sig) is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(g.sig)) is distinct from g.h then
   raise exception 'GUARDA_086: % no coincide con el cuerpo esperado',g.sig;
  end if;
 end loop;
end $guard$;

select pg_get_constraintdef(oid) as constraint_definition from pg_constraint where conrelid='public.enrollment_plan_options'::regclass and conname='enrollment_plan_options_horas_objetivo_check';
select column_default,is_nullable from information_schema.columns where table_schema='public' and table_name='enrollment_plan_options' and column_name='horas_objetivo';
select modalidad,horas_por_dia,habilitada,horas_objetivo,motivo from public.enrollment_plan_options order by 1,2;
select tipo,horas_requeridas from public.courses where tipo in('A','B');
select horas_practica_objetivo,count(*) from public.enrollments group by 1;
rollback;
