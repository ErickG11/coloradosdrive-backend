-- SOLO PGlite. Identidades sintéticas; sin correo, documento real ni conexión externa.
insert into auth.users(id) select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid
 from unnest(array[1,2,10,11,12,13,14,15,16,20]) n;
insert into public.users(id,cedula,nombre_completo,rol,activo,debe_cambiar_password,status)
 select id,lpad(row_number() over(order by id)::text,10,'0'),'Fixture Lote 1',
 case when right(id::text,2) in ('01','02') then 'admin'::public.user_role
      when right(id::text,2)='20' then 'instructor'::public.user_role else 'estudiante'::public.user_role end,
 true,false,'activo' from auth.users;
insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima)
 values('20000000-0000-0000-0000-000000000001','Fixture A','A',15,18);
insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,
 fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso,updated_at)
 values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
 'Fixture Cohorte',999,30,'2035-01-01','2035-01-10','2035-01-11','2040-01-01','2001-01-01Z');
insert into public.enrollments(id,student_id,course_id,cohort_id,status,monto_total,monto_abonado,
 horas_practica_objetivo,practice_plan,updated_at)
 select ('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-0000-0000-'||lpad((n+9)::text,12,'0'))::uuid,
 '20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
 'activo',100,case when n in (5,7) then 100 else 30 end,15,
 case when n in (1,4) then '{"fechas":["2030-01-07","2030-01-08"],"fechaFinElegida":"2030-02-01"}'::jsonb
      when n=3 then '{"fechas":["2030-02-30"]}'::jsonb else null end,
 '2001-01-01Z' from generate_series(1,7) n;
insert into public.student_schedule_reservations(id,student_id,enrollment_id,cohort_id,estado,
 creada_at,expira_at,cerrada_at,modalidad,fecha_inicio,horas_por_dia,margen_dias)
 select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-0000-0000-'||lpad((n+9)::text,12,'0'))::uuid,
 ('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '30000000-0000-0000-0000-000000000001','confirmada',
 '2029-12-01T12:00:00Z','2029-12-01T12:15:00Z','2029-12-01T12:05:00Z',
 'entre_semana','2030-01-07',5,5 from unnest(array[4,5]) n;
insert into public.student_schedule_holds(reservation_id,instructor_id,scheduled_at,held_from,expira_at,released_at)
 select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '10000000-0000-0000-0000-000000000020',
 '2030-01-07T11:00:00Z'::timestamptz+make_interval(days=>i/5,hours=>i%5),
 '2029-12-01T12:00:00Z','2029-12-01T12:15:00Z','2029-12-01T12:05:00Z'
 from unnest(array[4,5]) n cross join generate_series(0,14) i;
insert into public.payments(id,student_id,enrollment_id,reservation_id,attempt_key,proveedor,estado,
 subtotal_centavos,recargo_centavos,total_centavos,created_at)
 values('60000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000014',
 '40000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000005',
 '70000000-0000-0000-0000-000000000005','manual','aprobado',9000,1000,10000,'2029-12-01T12:05:00Z'),
 ('60000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000016',
 '40000000-0000-0000-0000-000000000007',null,
 '70000000-0000-0000-0000-000000000007','manual','aprobado',20000,0,20000,'2029-12-01T12:05:00Z');
