begin;
create temp table i13_fixture(actor uuid,students uuid[],enrollments uuid[],course uuid,cohort uuid,q text) on commit drop;
insert into i13_fixture values(gen_random_uuid(),array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()],array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()],gen_random_uuid(),gen_random_uuid(),'FixtureI13 '||gen_random_uuid()::text);
do $$ declare f i13_fixture;u uuid;c text;i integer;begin
 select * into f from i13_fixture;
 foreach u in array array_append(f.students,f.actor) loop
 insert into auth.users(id) values(u);
 loop c:=lpad(floor(random()*10000000000)::bigint::text,10,'0');exit when not exists(select 1 from public.users where cedula=c);end loop;
 insert into public.users(id,cedula,nombre_completo,rol,fecha_nacimiento) values(u,c,f.q,case when u=f.actor then 'admin'::public.user_role else 'estudiante'::public.user_role end,'1980-01-01');end loop;
 insert into public.courses(id,nombre,tipo,horas_requeridas) values(f.course,f.q,'B',15);
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,fecha_inicio_matricula,fecha_fin_matricula)
 values(f.cohort,f.course,f.q,100,5,current_date+10,current_date+40,current_date-1,current_date+5);
 insert into public.enrollments(id,student_id,course_id,status,monto_total) values(f.enrollments[1],f.students[1],f.course,'pendiente_cohorte',null);
 for i in 2..3 loop
 insert into public.enrollments(id,student_id,course_id,status,monto_total,origen,etapa_inscripcion)
 values(f.enrollments[i],f.students[i],f.course,'pendiente_cohorte',null,'solicitud','por_agendar');end loop;
 update public.enrollments set etapa_inscripcion='reservado',cohort_id=f.cohort,reserva_expira_at=clock_timestamp()+interval '15 minutes' where id=f.enrollments[3];
 insert into public.enrollments(id,student_id,cohort_id,status,monto_total) values(f.enrollments[4],f.students[4],f.cohort,'activo',100);
end $$;
grant select on i13_fixture to service_role;
set local role service_role;
do $$ declare f i13_fixture;j jsonb;begin
 select * into f from i13_fixture;
 j:=public.list_admin_students(f.actor,f.q,null,null,null,true,null,false,1,20);
 if(j->>'total')::integer<>1 or j->'items'->0->>'id'<>f.students[1]::text then raise exception 'Pendientes incluye etapa incompleta';end if;
 j:=public.list_admin_students(f.actor,f.q,null,null,null,false,null,false,1,20);
 if(j->>'total')::integer<>1 or j->'items'->0->>'id'<>f.students[4]::text then raise exception 'Filtro false incluye etapa incompleta';end if;
 j:=public.list_admin_students(f.actor,f.q,null,null,null,null,null,false,1,20);
 if(j->>'total')::integer<>4 then raise exception 'Listado general ocultó etapas';end if;
 if not exists(select 1 from jsonb_array_elements(j->'items') x cross join jsonb_array_elements(x->'matchingEnrollments') e where e->>'etapa'='por_agendar')
 or not exists(select 1 from jsonb_array_elements(j->'items') x cross join jsonb_array_elements(x->'matchingEnrollments') e where e->>'etapa'='reservado') then raise exception 'Perdió etapas para badges';end if;
 begin perform public.list_admin_students(f.students[1],f.q);raise exception 'Alumno obtuvo listado admin';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)','EXECUTE')
 or has_function_privilege('authenticated','public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)','EXECUTE') then raise exception 'Listado público';end if;
end $$;
reset role;
rollback;
