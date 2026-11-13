-- Solo lectura. Preflight de 064: exige los cuerpos conocidos (sin CR) y reporta el estado previo.
begin;
do $$ begin
 if to_regprocedure('public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date)')) not in ('5b939e177c1736cb32ac428816004493') then
  raise exception '064 preflight: falta función o cuerpo distinto: public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date)';end if;
 if to_regprocedure('public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text)')) not in ('b45d2bcd91e6a25c2b41caaadaa632bd') then
  raise exception '064 preflight: falta función o cuerpo distinto: public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text)';end if;
 if to_regprocedure('public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text)')) not in ('9f35fccc54d2dbbeef3480ecd69e165e') then
  raise exception '064 preflight: falta función o cuerpo distinto: public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text)';end if;
 if to_regprocedure('public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb)')) not in ('aa1e88f45ef7afd43c167de9f2d46a67') then
  raise exception '064 preflight: falta función o cuerpo distinto: public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb)';end if;
 if to_regprocedure('public.update_manual_enrollment_details(uuid,uuid,jsonb,jsonb)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.update_manual_enrollment_details(uuid,uuid,jsonb,jsonb)')) not in ('3b9018621fc8029e2f2c5c4c80899294') then
  raise exception '064 preflight: falta función o cuerpo distinto: public.update_manual_enrollment_details(uuid,uuid,jsonb,jsonb)';end if;
 if to_regprocedure('public.guard_cohort_schedule_reservations()') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.guard_cohort_schedule_reservations()')) not in ('3f910a4c6de29f0609f543cb70f736bb') then
  raise exception '064 preflight: falta función o cuerpo distinto: public.guard_cohort_schedule_reservations()';end if;
end $$;
do $$ declare v_a integer;v_b integer;begin
 select count(*) filter (where tipo='A'),count(*) filter (where tipo='B') into v_a,v_b from public.courses;
 if v_a<>1 or v_b<>1 or (select count(*) from public.courses)<>2 then
  raise exception '064 preflight: se esperaba exactamente un curso A y uno B (A=%, B=%)',v_a,v_b;end if;
 if to_regnamespace('private') is null then raise exception '064 preflight: falta el esquema private';end if;
 if not has_schema_privilege('service_role','private','USAGE') then raise exception '064 preflight: service_role sin USAGE en private';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='precio') then
  raise notice '064 preflight: courses.precio ya existe (¿ya aplicada?)';end if;
 if to_regprocedure('private.precio_curso(uuid)') is not null then
  raise notice '064 preflight: private.precio_curso ya existe';end if;
end $$;
select 'cursos' as seccion,tipo::text,nombre,id from public.courses order by tipo;
select 'cohorts.precio' as seccion,is_nullable,numeric_precision,numeric_scale
 from information_schema.columns where table_schema='public' and table_name='cohorts' and column_name='precio';
select 'cohortes' as seccion,count(*) as total,min(precio) as min_precio,max(precio) as max_precio from public.cohorts;
select 'matriculas' as seccion,count(*) as total,count(*) filter (where monto_total is null) as sin_monto from public.enrollments;
rollback;
