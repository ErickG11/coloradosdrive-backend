-- Solo arnésF45/manual, fixtures desechables. Nunca apunta a Supabase desde el arnés.
begin;
create temp table i05_fixture(student uuid,other_student uuid,instructor uuid,course uuid,cohort uuid,enrollment uuid,otro uuid,inicio date,slots timestamptz[]) on commit drop;
insert into i05_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null);
do $$ declare f i05_fixture;u uuid;c text;d date;v date[]:='{}';ats timestamptz[]:='{}';begin
 select * into f from i05_fixture;
 foreach u in array array[f.student,f.other_student,f.instructor] loop
 insert into auth.users(id) values(u);
 loop c:=lpad(floor(random()*10000000000)::bigint::text,10,'0');exit when not exists(select 1 from public.users where cedula=c);end loop;
 insert into public.users(id,cedula,nombre_completo,rol,status,fecha_nacimiento) values(u,c,'Fixture I05',
 case when u=f.instructor then 'instructor'::public.user_role else 'estudiante'::public.user_role end,'verificado','1980-01-01');end loop;
 insert into public.courses(id,nombre,tipo,horas_requeridas) values(f.course,'FixtureI05','B',15);
 d:=(clock_timestamp() at time zone 'America/Guayaquil')::date+10;
 while cardinality(v)<15 loop
 if extract(isodow from d) not in (6,7) then v:=array_append(v,d);ats:=array_append(ats,(d+time '10:00') at time zone 'America/Guayaquil');end if;
 d:=d+1;end loop;
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,fecha_inicio_matricula,fecha_fin_matricula)
 values(f.cohort,f.course,'FixtureI05',100,1,v[1]-1,v[15]+10,current_date-1,current_date+5);
 insert into public.enrollments(id,student_id,course_id,status,monto_total,origen,etapa_inscripcion,requisitos_verificados_at)
 values(f.enrollment,f.student,f.course,'pendiente_cohorte',null,'solicitud','por_agendar',clock_timestamp()),
 (f.otro,f.other_student,f.course,'pendiente_cohorte',null,'solicitud','por_agendar',clock_timestamp());
 update i05_fixture set inicio=v[1],slots=ats;
end $$;
grant select on i05_fixture to service_role;
set local role service_role;
do $$ declare f i05_fixture;r jsonb;rid uuid;rr jsonb;func text;t text;rol text;n integer;begin
 select * into f from i05_fixture;
 foreach t in array array['student_schedule_reservations','student_schedule_holds','student_schedule_daily','student_schedule_events'] loop
 if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'Falta RLS';end if;
 foreach rol in array array['anon','authenticated'] loop
 if has_table_privilege(rol,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Tabla accesible';end if;end loop;
 end loop;
 foreach func in array array['public.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer)',
 'public.manage_student_reservation(uuid,text,uuid,integer,integer,integer)','public.expire_student_reservations(uuid)',
 'public.student_schedule_free_slots(timestamptz[])','private.confirm_student_reservation(uuid,uuid)','private.close_student_reservation(uuid,text)'] loop
 foreach rol in array array['anon','authenticated'] loop
 if has_function_privilege(rol,func,'EXECUTE') then raise exception 'Función expuesta';end if;end loop;
 if not has_function_privilege('service_role',func,'EXECUTE') then raise exception 'Falta permiso servidor';end if;end loop;
 begin perform public.reserve_student_schedule(f.other_student,f.enrollment,f.slots,'entre_semana',f.inicio,1);
 raise exception 'Permitió matrícula ajena';exception when sqlstate 'IR404' then null;end;
 r:=public.reserve_student_schedule(f.student,f.enrollment,f.slots,'entre_semana',f.inicio,1);rid:=(r->>'id')::uuid;
 if r::text like '%instructor%' or r->>'estado'<>'vigente' or jsonb_array_length(r->'franjas')<>15 then raise exception 'DTO reserva inválido';end if;
 if public.cohort_cupo_ocupado(f.cohort)<>1 then raise exception 'Reserva no ocupa cupo';end if;
 if exists(select 1 from public.practice_free_instructors(array[f.slots[1]],f.instructor)) then raise exception 'Sugerencia ignoró hold';end if;
 begin insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,duration_minutes) values(f.cohort,f.instructor,f.slots[1],60);
 raise exception 'Manual ignoró hold';exception when sqlstate 'IR409' then null;end;
 begin perform public.reserve_student_schedule(f.other_student,f.otro,f.slots,'entre_semana',f.inicio,1);
 raise exception 'Reserva ignoró cupo';exception when sqlstate 'IR422' then null;end;
 r:=public.manage_student_reservation(f.student,'ampliar',rid);
 if (r->>'extensiones')::integer<>1 then raise exception 'No amplió';end if;
 begin perform public.manage_student_reservation(f.student,'ampliar',rid);
 raise exception 'Amplió dos veces';exception when sqlstate 'IR411' then null;end;
 r:=public.manage_student_reservation(f.student,'iniciar_pago',rid);
 rr:=public.manage_student_reservation(f.student,'iniciar_pago',rid);
 if r->>'expiraAt' is distinct from rr->>'expiraAt' then raise exception 'Pago extendió repetidamente';end if;
 begin perform public.manage_student_reservation(f.student,'liberar',rid);
 raise exception 'Liberó pago en curso';exception when sqlstate 'IR412' then null;end;
 -- Expiración perezosa: persistir salida, exactamente un aviso, sin depender del cron.
 update public.student_schedule_reservations set creada_at=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where id=rid;
 update public.student_schedule_holds set held_from=clock_timestamp()-interval '30 minutes',expira_at=clock_timestamp()-interval '1 minute' where reservation_id=rid;
 update public.enrollments set reserva_expira_at=clock_timestamp()-interval '1 minute' where id=f.enrollment;
 if public.cohort_cupo_ocupado(f.cohort)<>0 or not exists(select 1 from public.practice_free_instructors(array[f.slots[1]],f.instructor)) then raise exception 'Vencida ocupa';end if;
 r:=public.manage_student_reservation(f.student,'actual');
 perform public.manage_student_reservation(f.student,'actual');
 if r->>'estado'<>'vencida' or (select etapa_inscripcion from public.enrollments where id=f.enrollment)<>'por_agendar'
 or(select count(*) from public.notifications where user_id=f.student and titulo='Tu reserva de horario venció')<>1 then raise exception 'Expiración no idempotente';end if;
 -- Límite diario se conserva al liberar, pero fallos previos no consumen intentos.
 r:=public.reserve_student_schedule(f.student,f.enrollment,f.slots,'entre_semana',f.inicio,1);
 perform public.manage_student_reservation(f.student,'liberar',(r->>'id')::uuid);
 r:=public.reserve_student_schedule(f.student,f.enrollment,f.slots,'entre_semana',f.inicio,1);rid:=(r->>'id')::uuid;
 perform public.manage_student_reservation(f.student,'liberar',rid);
 begin perform public.reserve_student_schedule(f.student,f.enrollment,f.slots,'entre_semana',f.inicio,1);
 raise exception 'Superó límite diario';exception when sqlstate 'IR429' then null;end;
 -- Confirmación interna solo después del pago: nueva reserva de otro alumno.
 r:=public.reserve_student_schedule(f.other_student,f.otro,f.slots,'entre_semana',f.inicio,1);rid:=(r->>'id')::uuid;
 begin perform private.confirm_student_reservation(f.other_student,rid);
 raise exception 'Confirmó antes de pagar';exception when sqlstate 'IR403' then null;end;
 update public.users set status='activo' where id=f.other_student;
 update public.enrollments set etapa_inscripcion='activa',status='activo',reserva_expira_at=null,monto_total=100 where id=f.otro;
 perform private.confirm_student_reservation(f.other_student,rid);
 perform private.confirm_student_reservation(f.other_student,rid);
 select count(*) into n from public.practice_slots where student_id=f.other_student;
 if n<>15 then raise exception 'Confirmación duplicó o perdió franjas';end if;
end $$;
reset role;
rollback;
