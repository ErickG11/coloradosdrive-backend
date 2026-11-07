-- I02: solo arnésF45 o manual; fixtures aislados y ROLLBACK final.
begin;
create temp table i02_fixture(actor uuid,student uuid,other_student uuid,course uuid,cohort uuid,enrollment uuid,manual_enrollment uuid,sol uuid,claim timestamptz) on commit drop;
insert into i02_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),clock_timestamp());
do $$ declare f i02_fixture;v uuid;c text;r text;func text;begin
 select * into f from i02_fixture;
 foreach func in array array['public.cohort_cupo_ocupado(uuid,uuid)','public.cohort_cupos_ocupados(uuid[])',
 'public.enforce_cohort_cupo()','public.guard_cohort_reserved_capacity()','public.guard_new_solicitud_enrollment()'] loop
 foreach r in array array['anon','authenticated'] loop
 if has_function_privilege(r,func,'EXECUTE') then raise exception 'RPC accesible a %',r;end if;end loop;
 if not has_function_privilege('service_role',func,'EXECUTE') then raise exception 'Falta permiso backend';end if;
 end loop;
 if not (select relrowsecurity from pg_class where oid='public.enrollments'::regclass) then raise exception 'FaltaRLS';end if;
 foreach r in array array['anon','authenticated'] loop
 if has_table_privilege(r,'public.enrollments','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Tabla accesible a %',r;end if;end loop;
 foreach v in array array[f.actor,f.student,f.other_student] loop
 loop c:=lpad(floor(random()*10000000000)::bigint::text,10,'0');exit when not exists(select 1 from public.users where cedula=c);end loop;
 insert into auth.users(id) values(v);
 if v<>f.student then insert into public.users(id,cedula,nombre_completo,rol,fecha_nacimiento)
 values(v,c,'Fixture I02',case when v=f.actor then 'admin'::public.user_role else 'estudiante'::public.user_role end,'1980-01-01');end if;
 end loop;
 insert into public.courses(id,nombre,tipo) values(f.course,'FixtureI02','B');
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,fecha_inicio_matricula,fecha_fin_matricula)
 values(f.cohort,f.course,'FixtureI02',100,1,current_date+10,current_date+40,current_date-10,current_date+5);
 loop c:=lpad(floor(random()*10000000000)::bigint::text,10,'0');exit when not exists(select 1 from public.users where cedula=c) and not exists(select 1 from public.solicitudes_inscripcion where cedula=c);end loop;
 insert into public.solicitudes_inscripcion(id,correo,cedula,nombre_completo,nombres,apellidos,fecha_nacimiento,course_id,
 correo_verificado,estado,solicitada_at,datos_actualizados_at,nacionalidad_tipo,tipo_sangre,nivel_estudios,reviewed_by,reviewed_at)
 values(f.sol,'fixture-i02-'||f.sol||'@example.com',c,'Fixture Alumno','Fixture','Alumno','1980-01-01',f.course,
 true,'enviada',clock_timestamp(),clock_timestamp(),'ecuatoriana','O+','bachiller',f.actor,f.claim);
 insert into public.solicitud_aprobacion_intentos(id,solicitud_id,actor_id,claim) values(f.student,f.sol,f.actor,f.claim);
end $$;
grant select on i02_fixture to service_role;
set local role service_role;
do $$ declare f i02_fixture;r jsonb;e public.enrollments;v_count bigint;begin
 select * into f from i02_fixture;
 -- La aprobación NO consume cupo ni calcula precio aun existiendo una cohorte elegible.
 r:=public.finalizar_aprobacion_inscripcion(f.sol,f.actor,f.claim,f.student,null,'pendiente_cohorte',null);
 select * into e from public.enrollments where id=(r->>'enrollmentId')::uuid;
 if e.etapa_inscripcion<>'por_agendar' or e.cohort_id is not null or e.monto_total is not null then raise exception 'Aprobación asignó cohorte/monto';end if;
 if (select count(*) from public.enrollment_documents where enrollment_id=e.id)<>4 then raise exception 'No creó checklist';end if;
 if (select estado from public.solicitud_aprobacion_intentos where id=f.student)<>'completado' then raise exception 'Rompió guarda055';end if;
 begin perform public.assign_pending_enrollment_cohort(f.actor,f.student,e.id,f.cohort,clock_timestamp(),current_date);
 raise exception 'Permitió asignación manual sin pago';exception when sqlstate 'IE403' then null;end;
 -- Las filas manuales conservan defaultactiva, cohorte/precio y capacidad original.
 insert into public.enrollments(id,student_id,cohort_id,status,monto_total)
 values(f.manual_enrollment,f.other_student,f.cohort,'activo',100);
 if (select etapa_inscripcion from public.enrollments where id=f.manual_enrollment)<>'activa' then raise exception 'Alteró manual';end if;
 if public.cohort_cupo_ocupado(f.cohort)<>1 then raise exception 'Conteo manual inválido';end if;
 begin update public.enrollments set etapa_inscripcion='reservado',cohort_id=f.cohort,reserva_expira_at=clock_timestamp()+interval '15 minutes' where id=e.id;
 raise exception 'Reserva superó cupo';exception when sqlstate 'CD001' then null;end;
 update public.enrollments set status='retirado' where id=f.manual_enrollment;
 update public.enrollments set etapa_inscripcion='reservado',cohort_id=f.cohort,reserva_expira_at=clock_timestamp()+interval '15 minutes' where id=e.id;
 if public.cohort_cupo_ocupado(f.cohort)<>1 then raise exception 'Reserva vigente no cuenta';end if;
 begin update public.enrollments set status='activo' where id=f.manual_enrollment;
 raise exception 'Manual ignoró reserva vigente';exception when sqlstate 'CD001' then null;end;
 update public.enrollments set reserva_expira_at=clock_timestamp()-interval '1 minute' where id=e.id;
 if public.cohort_cupo_ocupado(f.cohort)<>0 then raise exception 'Reserva vencida cuenta';end if;
 update public.enrollments set status='activo' where id=f.manual_enrollment;
 -- Pago posterior: transición al mismo cupo no debe contarse dos veces.
 update public.enrollments set status='retirado' where id=f.manual_enrollment;
 update public.enrollments set reserva_expira_at=clock_timestamp()+interval '15 minutes' where id=e.id;
 update public.enrollments set etapa_inscripcion='activa',reserva_expira_at=null,status='activo',monto_total=100 where id=e.id;
 if public.cohort_cupo_ocupado(f.cohort)<>1 then raise exception 'Doble conteo al activar';end if;
 -- Recortar cupo cuenta reservas además de activas, bajo el lock de cohorte.
 update public.cohorts set cupo_maximo=2 where id=f.cohort;
 update public.enrollments set status='activo' where id=f.manual_enrollment;
 begin update public.cohorts set cupo_maximo=1 where id=f.cohort;
 raise exception 'Redujo cupo por debajo de ocupación';exception when sqlstate 'IC409' then null;end;
 r:=public.list_admin_students(f.actor,null,null,null,f.cohort,null,null,false,1,20);
 if (r->'cohortSummary'->>'usedCapacity')::integer<>2 then raise exception 'Resumen ignora cupo';end if;
end $$;
reset role;
rollback;
