-- 064 verificación. NO modifica datos: solo SELECT/asserts y ROLLBACK final. Ejecutar DESPUÉS de aplicar 064.
begin;
-- 1) Precios por tipo.
select tipo::text,nombre,precio from public.courses order by tipo;
do $$ begin
 if (select precio from public.courses where tipo='A')<>150.00 then raise exception '064 ver: tipo A distinto de 150.00';end if;
 if (select precio from public.courses where tipo='B')<>200.00 then raise exception '064 ver: tipo B distinto de 200.00';end if;
 if exists(select 1 from public.courses where precio is null or precio<0 or precio>9999.99) then raise exception '064 ver: precio fuera de rango';end if;
 if (select is_nullable from information_schema.columns where table_schema='public' and table_name='courses' and column_name='precio')<>'NO' then raise exception '064 ver: courses.precio admite NULL';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.courses'::regclass and conname='courses_precio_rango') then raise exception '064 ver: falta courses_precio_rango';end if;
end $$;
-- 2) private.precio_curso para ambos cursos y error con curso inexistente.
select c.tipo::text,private.precio_curso(c.id) as precio_curso from public.courses c order by c.tipo;
do $$ begin
 if exists(select 1 from public.courses c where private.precio_curso(c.id) is distinct from c.precio) then raise exception '064 ver: precio_curso no coincide con courses.precio';end if;
 begin perform private.precio_curso(gen_random_uuid());raise exception '064 ver: aceptó curso inexistente';
 exception when sqlstate 'PC404' then null;end;
 if (select provolatile from pg_proc where oid=to_regprocedure('private.precio_curso(uuid)'))<>'s' then raise exception '064 ver: precio_curso no es stable';end if;
 if not (select proconfig @> array['search_path=""'] from pg_proc where oid=to_regprocedure('private.precio_curso(uuid)')) then raise exception '064 ver: precio_curso sin search_path fijo';end if;
end $$;
do $$ declare r text;begin
 foreach r in array array['anon','authenticated'] loop
  if has_function_privilege(r,'private.precio_curso(uuid)','EXECUTE') then raise exception '064 ver: precio_curso ejecutable por %',r;end if;end loop;
 if exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid=to_regprocedure('private.precio_curso(uuid)') and a.grantee=0) then raise exception '064 ver: precio_curso ejecutable por PUBLIC';end if;
 if not has_function_privilege('service_role','private.precio_curso(uuid)','EXECUTE') then raise exception '064 ver: falta permiso service_role';end if;
end $$;
-- 3) Nuevos md5 de las seis piezas (esperados calculados desde 064_precio_por_tipo_curso.sql).
with esperado(nombre,md5_esperado) as (values
  ('assign_pending_enrollment_cohort','c4eab19a0d0a909b73e7ca8c9a9446c2'),
  ('begin_student_payment','43aa977085039a6e707f78f10bc1225e'),
  ('confirm_student_payment','e812f7becade587b99bb62582907009d'),
  ('commit_manual_enrollment','9c73e150d35de08694bb475f0862228e'),
  ('update_manual_enrollment_details','188286b9e26564713336b6ab9d6be976'),
  ('guard_cohort_schedule_reservations','ccebbc6febb0dfb180fc6ee4dbd41d71'))
select e.nombre,e.md5_esperado,md5(replace(p.prosrc,chr(13),'')) as md5_actual,
 md5(replace(p.prosrc,chr(13),''))=e.md5_esperado as ok
from esperado e join pg_proc p on p.proname=e.nombre and p.pronamespace='public'::regnamespace order by e.nombre;
do $$ begin
 if exists(select 1 from (values
  ('assign_pending_enrollment_cohort','c4eab19a0d0a909b73e7ca8c9a9446c2'),
  ('begin_student_payment','43aa977085039a6e707f78f10bc1225e'),
  ('confirm_student_payment','e812f7becade587b99bb62582907009d'),
  ('commit_manual_enrollment','9c73e150d35de08694bb475f0862228e'),
  ('update_manual_enrollment_details','188286b9e26564713336b6ab9d6be976'),
  ('guard_cohort_schedule_reservations','ccebbc6febb0dfb180fc6ee4dbd41d71')) e(nombre,m)
  where not exists(select 1 from pg_proc p where p.proname=e.nombre and p.pronamespace='public'::regnamespace
   and md5(replace(p.prosrc,chr(13),''))=e.m)) then raise exception '064 ver: algún cuerpo no coincide con el esperado';end if;
 if (select prosrc from pg_proc where proname='guard_cohort_schedule_reservations' and pronamespace='public'::regnamespace) ~* 'new\.precio' then
  raise exception '064 ver: el disparador todavía compara precio';end if;
end $$;
-- 4) cohorts.precio conservada, sin NOT NULL, con comentario de obsolescencia.
do $$ begin
 if (select is_nullable from information_schema.columns where table_schema='public' and table_name='cohorts' and column_name='precio')<>'YES' then raise exception '064 ver: cohorts.precio sigue NOT NULL';end if;
 if coalesce(col_description('public.cohorts'::regclass,(select attnum from pg_attribute where attrelid='public.cohorts'::regclass and attname='precio')),'') not like 'OBSOLETA%' then raise exception '064 ver: falta comentario de obsolescencia';end if;
end $$;
rollback;
