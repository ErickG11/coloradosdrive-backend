-- MANUAL/arnés F45. Todo se revierte.
begin;
do $$ declare rol text;f text:='public.confirmar_identidad_presencial_admin(uuid,uuid,text)';begin
 if to_regprocedure(f) is null then raise exception 'Falta RPC056';end if;
 foreach rol in array array['anon','authenticated'] loop
 if has_function_privilege(rol,f,'EXECUTE') or has_table_privilege(rol,'public.identidad_presencial_overrides','SELECT,INSERT,UPDATE,DELETE') then
 raise exception 'Acceso indebido %',rol;end if;end loop;
 if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Falta permiso backend';end if;
 if not (select relrowsecurity from pg_class where oid='public.identidad_presencial_overrides'::regclass)
 or exists(select 1 from pg_policies where schemaname='public' and tablename='identidad_presencial_overrides') then raise exception 'RLS inválido';end if;
 begin perform public.confirmar_identidad_presencial_admin(gen_random_uuid(),gen_random_uuid(),'breve');
 raise exception 'Aceptó motivo breve';exception when sqlstate 'IP422' then null;end;
 begin perform public.confirmar_identidad_presencial_admin(gen_random_uuid(),gen_random_uuid(),'Motivo de prueba local');
 raise exception 'Aceptó actor inexistente';exception when sqlstate 'IP403' then null;end;
end $$;

create temp table identidad056_fixture(student uuid,actor uuid,instructor uuid,course uuid,cohort uuid,enrollment uuid,slot uuid) on commit drop;
insert into identidad056_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
do $$ declare f identidad056_fixture;v_user uuid;v_cedula text;begin
 select * into f from identidad056_fixture;
 foreach v_user in array array[f.student,f.actor,f.instructor] loop
 loop
 v_cedula:=lpad(floor(random()*10000000000)::bigint::text,10,'0');
 exit when not exists(select 1 from public.users where cedula=v_cedula);end loop;
 insert into auth.users(id) values(v_user);
 insert into public.users(id,cedula,nombre_completo,rol) values(v_user,v_cedula,'Fixture056',
 case when v_user=f.actor then 'admin'::public.user_role when v_user=f.instructor then 'instructor'::public.user_role else 'estudiante'::public.user_role end);
 end loop;
 insert into public.courses(id,nombre,tipo) values(f.course,'Fixture056','B');
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,fecha_inicio_matricula,fecha_fin_matricula)
 values(f.cohort,f.course,'Fixture056',100,10,current_date-40,current_date+40,current_date-60,current_date-41);
 insert into public.enrollments(id,student_id,cohort_id,status,monto_total,origen)
 values(f.enrollment,f.student,f.cohort,'activo',100,'solicitud');
 insert into public.practice_slots(id,cohort_id,instructor_id,student_id,scheduled_at,status)
 values(f.slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '1 hour','completado');
end $$;
grant select on identidad056_fixture to service_role;
set local role service_role;
do $$ declare f identidad056_fixture;r jsonb;r2 jsonb;begin
 select * into f from identidad056_fixture;
 begin perform public.confirmar_identidad_presencial_admin(f.student,f.instructor,'Motivo válido del fixture');
 raise exception 'Aceptó instructor';exception when sqlstate 'IP403' then null;end;
 begin perform public.confirmar_identidad_presencial_admin(f.student,f.actor,'Motivo válido del fixture');
 raise exception 'Aceptó práctica en ventana';exception when sqlstate 'IP410' then null;end;
 update public.practice_slots set scheduled_at=clock_timestamp()-interval '4 days' where id=f.slot;
 update public.enrollments set origen='manual' where id=f.enrollment;
 begin perform public.confirmar_identidad_presencial_admin(f.student,f.actor,'Motivo válido del fixture');
 raise exception 'Aceptó matrícula manual';exception when sqlstate 'IP412' then null;end;
 update public.enrollments set origen='solicitud' where id=f.enrollment;
 r:=public.confirmar_identidad_presencial_admin(f.student,f.actor,'Se revisó la identidad presencialmente');
 if not (r->>'transicion')::boolean or (r->>'confirmadaPor')::uuid<>f.actor then raise exception 'No confirmó con actor admin';end if;
 r2:=public.confirmar_identidad_presencial_admin(f.student,f.actor,'Segundo motivo que no debe guardarse');
 if (r2->>'transicion')::boolean or r2->>'confirmadaAt' is distinct from r->>'confirmadaAt' then raise exception 'Reescribió confirmación';end if;
 if (select count(*) from public.identidad_presencial_overrides where enrollment_id=f.enrollment)<>1 then raise exception 'Auditoría duplicada';end if;
 if (select certificado_original_visto from public.enrollments where id=f.enrollment) then raise exception 'Marcó certificado sin verlo';end if;
end $$;
reset role;
rollback;
