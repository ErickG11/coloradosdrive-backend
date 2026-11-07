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
do $$ declare f i10_fixture;r jsonb;pid uuid;res uuid;k uuid;begin
 select * into f from i10_fixture;
 r:=public.reserve_student_schedule(f.student,f.enrollment,f.slots,'entre_semana',f.inicio,1);res:=(r->>'id')::uuid;
 r:=public.begin_student_payment(f.student,res,'kushki',gen_random_uuid());pid:=(r->>'id')::uuid;
 update public.student_schedule_reservations set creada_at=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where id=res;
 update public.student_schedule_holds set held_from=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where reservation_id=res;
 update public.enrollments set reserva_expira_at=clock_timestamp()-interval '1 minute' where id=f.enrollment;
 if public.claim_payment_dispatch(pid) then raise exception 'Envió un pago con reserva vencida';end if;
 if(select estado from public.payments where id=pid)<>'rechazado' or(select dispatch_at from public.payments where id=pid) is not null then raise exception 'No canceló intento sin envío';end if;
 if(select count(*) from public.payment_events where payment_id=pid)<>1 then raise exception 'Falta evento de caducidad';end if;
 perform public.expire_student_reservations(f.student);
 if(select count(*) from public.payment_events where payment_id=pid)<>1 then raise exception 'Duplicó evento de caducidad';end if;
 -- Otra reserva/intento ahora sí es posible; un envío ya reclamado nunca caduca dinero localmente.
 r:=public.reserve_student_schedule(f.student,f.enrollment,f.slots,'entre_semana',f.inicio,1);res:=(r->>'id')::uuid;
 r:=public.begin_student_payment(f.student,res,'kushki',gen_random_uuid());pid:=(r->>'id')::uuid;
 if not public.claim_payment_dispatch(pid) or public.claim_payment_dispatch(pid) then raise exception 'Claim no exclusivo';end if;
 update public.student_schedule_reservations set creada_at=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where id=res;
 update public.student_schedule_holds set held_from=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where reservation_id=res;
 update public.enrollments set reserva_expira_at=clock_timestamp()-interval '1 minute' where id=f.enrollment;
 perform public.expire_student_reservations(f.student);
 if(select estado from public.payments where id=pid)<>'pendiente' then raise exception 'Canceló un envío incierto';end if;
 r:=public.confirm_student_payment(pid,'kushki','fixture062','aprobado',10000,'USD',repeat('5',64),repeat('6',64));
 if r->>'estado'<>'aprobado' then raise exception 'Pago enviado tardío libre no activó';end if;
 if (select status from public.users where id=f.student)<>'activo' then raise exception 'No activó perfil';end if;
 if has_function_privilege('authenticated','public.claim_payment_dispatch(uuid)','EXECUTE') or has_function_privilege('anon','public.expire_student_reservations(uuid)','EXECUTE') then raise exception 'RPC expuesta';end if;
end $$;
reset role;
rollback;
