-- Solo arnésF45/manual; fixtures aisladas y ROLLBACK. No SQL remoto automático.
begin;
create temp table i10_fixture(student uuid,other_student uuid,instructor uuid,actor uuid,course uuid,cohort uuid,enrollment uuid,otro uuid,third_student uuid,third_enrollment uuid,inicio date,slots timestamptz[]) on commit drop;
insert into i10_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null);
do $$ declare f i10_fixture;u uuid;c text;d date;v date[]:='{}';ats timestamptz[]:='{}';begin
 select * into f from i10_fixture;
 foreach u in array array[f.student,f.other_student,f.instructor,f.actor,f.third_student] loop
 insert into auth.users(id) values(u);
 loop c:=lpad(floor(random()*10000000000)::bigint::text,10,'0');exit when not exists(select 1 from public.users where cedula=c);end loop;
 insert into public.users(id,cedula,nombre_completo,rol,status,fecha_nacimiento) values(u,c,'Fixture I10',
 case when u=f.instructor then 'instructor'::public.user_role when u=f.actor then 'admin'::public.user_role else 'estudiante'::public.user_role end,'verificado','1980-01-01');end loop;
 insert into public.courses(id,nombre,tipo,horas_requeridas) values(f.course,'FixtureI10','B',15);
 d:=(clock_timestamp() at time zone 'America/Guayaquil')::date+10;
 while cardinality(v)<15 loop
 if extract(isodow from d) not in (6,7) then v:=array_append(v,d);ats:=array_append(ats,(d+time '10:00') at time zone 'America/Guayaquil');end if;
 d:=d+1;end loop;
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,fecha_inicio_matricula,fecha_fin_matricula)
 values(f.cohort,f.course,'FixtureI10',100,1,v[1]-1,v[15]+10,current_date-1,current_date+5);
 insert into public.enrollments(id,student_id,course_id,status,monto_total,origen,etapa_inscripcion,requisitos_verificados_at)
 values(f.enrollment,f.student,f.course,'pendiente_cohorte',null,'solicitud','por_agendar',clock_timestamp()),
 (f.otro,f.other_student,f.course,'pendiente_cohorte',null,'solicitud','por_agendar',clock_timestamp()),
 (f.third_enrollment,f.third_student,f.course,'pendiente_cohorte',null,'solicitud','por_agendar',clock_timestamp());
 update i10_fixture set inicio=v[1],slots=ats;
end $$;
grant select on i10_fixture to service_role;
set local role service_role;
do $$ declare f i10_fixture;r jsonb;res uuid;p jsonb;pid uuid;k uuid;dup jsonb;token uuid;func text;t text;rol text;v_expira timestamptz;v_ref text;begin
 select * into f from i10_fixture;
 foreach t in array array['payments','payment_events','payment_mail_outbox'] loop
 if not(select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'FaltaRLS';end if;
 foreach rol in array array['anon','authenticated'] loop
 if has_table_privilege(rol,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Tabla expuesta';end if;end loop;end loop;
 foreach func in array array['public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text)',
 'public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text)','public.claim_payment_dispatch(uuid)',
 'public.record_payment_reference(uuid,text,text)','public.admin_release_student_reservation(uuid,uuid)',
 'private.payment_json(uuid)','public.claim_payment_email(uuid)','public.finish_payment_email(uuid,uuid,boolean)'] loop
 foreach rol in array array['anon','authenticated'] loop
 if has_function_privilege(rol,func,'EXECUTE') then raise exception 'Función expuesta';end if;end loop;
 if not has_function_privilege('service_role',func,'EXECUTE') then raise exception 'Falta execute backend';end if;end loop;
 r:=public.reserve_student_schedule(f.student,f.enrollment,f.slots,'entre_semana',f.inicio,1);res:=(r->>'id')::uuid;k:=gen_random_uuid();
 begin perform public.begin_student_payment(f.student,res,'manual',k,0,10,f.student);raise exception 'Estudiante registró efectivo';exception when insufficient_privilege then null;end;
 p:=public.begin_student_payment(f.student,res,'kushki',k);pid:=(p->>'id')::uuid;
 dup:=public.begin_student_payment(f.student,res,'kushki',k);
 if dup->>'id'<>p->>'id' or (p->>'totalCentavos')::bigint<>10000 then raise exception 'Intento no idempotente o monto incorrecto';end if;
 if not public.claim_payment_dispatch(pid) or public.claim_payment_dispatch(pid) then raise exception 'Dispatch repetido';end if;
 begin perform public.begin_student_payment(f.other_student,res,'simulado',k);raise exception 'Usó clave ajena';exception when sqlstate 'IP409' then null;end;
 begin perform public.begin_student_deletion(f.actor,f.student,(select cedula from public.users where id=f.student));raise exception 'Borró pago pendiente';exception when sqlstate 'IP423' then null;end;
 -- Pendiente/rechazado aceptan cero y moneda distinta sin IP422, guardando lo recibido.
 select expira_at into v_expira from public.student_schedule_reservations where id=res;
 p:=public.confirm_student_payment(pid,'kushki','fixture1','pendiente',0,'EUR',repeat('3',64),repeat('4',64));
 if p->>'estado'<>'pendiente' or not exists(select 1 from public.payments where id=pid and recibido_centavos=0 and recibido_moneda='EUR') then raise exception 'No conservó importe pendiente';end if;
 -- Sin ticket en DECLINED usa la referencia real guardada, sin cambiar el vencimiento.
 p:=public.confirm_student_payment(pid,'kushki',null,'rechazado',0,'GBP',repeat('a',64),repeat('b',64));
 if p->>'estado'<>'rechazado' or not exists(select 1 from public.payments where id=pid and referencia='fixture1' and recibido_centavos=0 and recibido_moneda='GBP') then raise exception 'No rechazó importe cero/sin ticket';end if;
 if not exists(select 1 from public.student_schedule_reservations where id=res and estado='vigente' and expira_at=v_expira) then raise exception 'Rechazo alteró vencimiento/estado de reserva';end if;
 begin perform public.manage_student_reservation(f.student,'ampliar',res);raise exception 'Amplió después de iniciar pago';exception when sqlstate 'IR411' then null;end;
 -- Sin referencia HTTP aún: sintética propia y estable, reemplazable por el ticket real.
 p:=public.begin_student_payment(f.student,res,'kushki',gen_random_uuid());pid:=(p->>'id')::uuid;
 begin perform public.confirm_student_payment(pid,'kushki',null,'aprobado',10000,'USD',repeat('5',64),repeat('6',64));raise exception 'Aceptó aprobación sin ticket';exception when invalid_parameter_value then null;end;
 p:=public.confirm_student_payment(pid,'kushki',null,'rechazado',0,'USD',repeat('7',64),repeat('8',64));
 v_ref:='kushki-rechazado:'||pid::text;
 if p->>'estado'<>'rechazado' or(select referencia from public.payments where id=pid)<>v_ref then raise exception 'Falta referencia sintética estable';end if;
 perform public.record_payment_reference(pid,'kushki','fixture-sin-ticket');
 dup:=public.confirm_student_payment(pid,'kushki',v_ref,'rechazado',0,'USD',repeat('7',64),repeat('8',64));
 if dup->>'estado'<>'rechazado' or(select referencia from public.payments where id=pid)<>'fixture-sin-ticket'
 or(select count(*) from public.payment_events where payment_id=pid)<>1 then raise exception 'Replay sintético cambió referencia o duplicó evento';end if;
 if not exists(select 1 from public.student_schedule_reservations where id=res and estado='vigente' and expira_at=v_expira) then raise exception 'Rechazo sin referencia renovó plazo';end if;
 p:=public.begin_student_payment(f.student,res,'simulado',gen_random_uuid());pid:=(p->>'id')::uuid;
 p:=public.confirm_student_payment(pid,'simulado','fixture2','aprobado',10000,'USD',repeat('c',64),repeat('d',64));
 if p->>'estado'<>'aprobado' then raise exception 'No activó: %',p;end if;
 if(select status from public.users where id=f.student)<>'activo'
 or not exists(select 1 from public.enrollments where id=f.enrollment and etapa_inscripcion='activa' and status='activo' and monto_abonado=100 and monto_total=100)
 or(select count(*) from public.practice_slots where student_id=f.student)<>15 then raise exception 'Activación no atómica';end if;
 dup:=public.confirm_student_payment(pid,'simulado','fixture2','aprobado',10000,'USD',repeat('c',64),repeat('d',64));
 if (select count(*) from public.practice_slots where student_id=f.student)<>15
 or(select count(*) from public.payment_mail_outbox where payment_id=pid)<>1 then raise exception 'Duplicó efectos';end if;
 begin perform public.confirm_student_payment(pid,'simulado','fixture2','aprobado',1,'USD',repeat('c',64),repeat('e',64));raise exception 'Aceptó replay distinto';exception when sqlstate 'IP409' then null;end;
 token:=public.claim_payment_email(pid);
 if token is null or public.claim_payment_email(pid) is not null then raise exception 'Lease correo no exclusivo';end if;
 if public.finish_payment_email(pid,gen_random_uuid(),true) then raise exception 'Cerró lease ajeno';end if;
 if not public.finish_payment_email(pid,token,true) then raise exception 'No cerró correo';end if;
 -- Un rechazo tardío con importe/moneda distintos tampoco lanza IP422 ni revoca acceso.
 dup:=public.confirm_student_payment(pid,'simulado','fixture2','rechazado',0,'EUR',repeat('9',64),repeat('a',64));
 if dup->>'estado'<>'aprobado' or not exists(select 1 from public.payments where id=pid and recibido_centavos=0 and recibido_moneda='EUR') then raise exception 'Rechazo tardío revocó o comparó importe';end if;
 -- Liberar cupo de fixture1, reservar fixture2 y recibir un monto distinto: conserva dinero, no activa.
 update public.enrollments set status='retirado' where id=f.enrollment;
 r:=public.reserve_student_schedule(f.other_student,f.otro,array(select x+interval '1 hour' from unnest(f.slots) x),'entre_semana',f.inicio,1);
 res:=(r->>'id')::uuid;
 p:=public.begin_student_payment(f.other_student,res,'manual',gen_random_uuid(),0,10,f.actor,'Referencia ficticia');pid:=(p->>'id')::uuid;
 p:=public.confirm_student_payment(pid,'manual','fixture3','aprobado',9999,'USD',repeat('f',64),repeat('0',64));
 if p->>'estado'<>'revision' or(select status from public.users where id=f.other_student)<>'verificado'
 or (select etapa_inscripcion from public.enrollments where id=f.otro)<>'reservado'
 or exists(select 1 from public.practice_slots where student_id=f.other_student) then raise exception 'Monto distinto activó o no conservó dinero';end if;
 -- Pago aprobado tardío con franjas ya ocupadas: rollback de activación, dinero en revisión.
 update public.student_schedule_reservations set creada_at=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where id=res;
 update public.student_schedule_holds set held_from=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where reservation_id=res;
 update public.enrollments set reserva_expira_at=clock_timestamp()-interval '1 minute' where id=f.otro;
 perform public.expire_student_reservations(f.other_student);
 r:=public.reserve_student_schedule(f.third_student,f.third_enrollment,array(select x+interval '2 hours' from unnest(f.slots) x),'entre_semana',f.inicio,1);
 res:=(r->>'id')::uuid;
 p:=public.begin_student_payment(f.third_student,res,'simulado',gen_random_uuid());pid:=(p->>'id')::uuid;
 update public.student_schedule_reservations set creada_at=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where id=res;
 update public.student_schedule_holds set held_from=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where reservation_id=res;
 update public.enrollments set reserva_expira_at=clock_timestamp()-interval '1 minute' where id=f.third_enrollment;
 perform public.expire_student_reservations(f.third_student);
 insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,duration_minutes)
 select f.cohort,id,f.slots[1]+interval '2 hours',60 from public.practice_free_instructors(array[f.slots[1]+interval '2 hours']);
 p:=public.confirm_student_payment(pid,'simulado','fixture4','aprobado',10000,'USD',repeat('1',64),repeat('2',64));
 if p->>'estado'<>'revision' or(select status from public.users where id=f.third_student)<>'verificado'
 or (select etapa_inscripcion from public.enrollments where id=f.third_enrollment)<>'por_agendar'
 or exists(select 1 from public.practice_slots where student_id=f.third_student) then raise exception 'Pago tardío no conservó atomicidad/dinero';end if;
end $$;
reset role;
rollback;
