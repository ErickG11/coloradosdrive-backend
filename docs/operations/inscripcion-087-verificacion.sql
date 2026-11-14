-- Solo fixtures sintéticos. No persiste datos ni el reloj de prueba.
begin;
create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select coalesce(nullif(current_setting('c09.test_now',true),''),'2026-11-12T17:00:00Z')::timestamptz$$;
do $$declare student uuid:=gen_random_uuid();course uuid:=gen_random_uuid();cohort uuid:=gen_random_uuid();enrollment uuid:=gen_random_uuid();begin
 insert into auth.users(id) values(student);
 insert into public.users(id,cedula,nombre_completo,rol,activo,status,debe_cambiar_password)
 values(student,substr(translate(student::text,'abcdef-','1234560'),1,10),'Verificación sintética C09','estudiante',true,'activo',false);
 insert into public.courses(id,nombre,tipo,horas_requeridas) values(course,'Verificación C09','A',10);
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
 values(cohort,course,'Verificación C09',100,30,'2026-11-01','2026-11-29','2026-11-30','2026-12-31');
 insert into public.enrollments(id,student_id,course_id,course_type,cohort_id,status,origen,etapa_inscripcion,monto_total,monto_abonado,paid_amount_centavos,horas_practica_objetivo,practice_start_date,practice_end_date,access_end_date,individual_dates_source,individual_dates_guard_ready)
 values(enrollment,student,course,'A',cohort,'activo','manual','activa',100,100,10000,10,'2026-11-30','2026-12-04','2026-12-31','practice_plan',true);
 if not private.enrollment_has_access_v2(enrollment) then raise exception 'C09: pago completo y prácticas futuras debe dar acceso';end if;
 update public.enrollments set paid_amount_centavos=9999 where id=enrollment;
 if private.enrollment_has_access_v2(enrollment) then raise exception 'C09: pago incompleto no debe dar acceso';end if;
 update public.enrollments set paid_amount_centavos=10000 where id=enrollment;
 perform set_config('c09.test_now','2027-01-01T05:00:00Z',true);
 if private.enrollment_has_access_v2(enrollment) then raise exception 'C09: acceso vencido no debe dar acceso';end if;
 perform set_config('c09.test_now','2026-11-12T17:00:00Z',true);
 update public.users set identity_access_blocked_at=clock_timestamp() where id=student;
 if private.enrollment_has_access_v2(enrollment) then raise exception 'C09: identidad bloqueada no debe dar acceso';end if;
 update public.users set identity_access_blocked_at=null where id=student;
 update public.enrollments set status='finalizado' where id=enrollment;
 if not private.enrollment_has_access_v2(enrollment) then raise exception 'C09: finalizado dentro del período debe conservar acceso';end if;
end $$;
select 'C09: acceso futuro, pago, vencimiento, identidad y finalizado correctos' as resultado;
rollback;
