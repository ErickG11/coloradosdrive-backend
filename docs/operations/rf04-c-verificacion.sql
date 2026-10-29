-- SQL Editor: ejecutar ENTERO despues de 036, incluido ROLLBACK.
-- Fixtures propios; no DELETE, no triggers deshabilitados, sin datos reales.
-- Solo el propietario del SQL Editor mueve el corte temporalmente; ROLLBACK lo restaura.
begin;
set local lock_timeout = '5s';
create temp table rf04_c_fixture (
  student uuid, instructor uuid, empty_instructor uuid, admin uuid,
  course uuid, cohort uuid, enrollment uuid
) on commit drop;
insert into rf04_c_fixture select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
create temp table rf04_c_slots (n integer primary key, slot uuid, score integer) on commit drop;
insert into rf04_c_slots select ordinality,gen_random_uuid(),score
  from unnest(array[1,2,4,5,5,5,3]) with ordinality x(score,ordinality);
update private.practice_rating_rollout set enabled_at=clock_timestamp()-interval '10 days' where singleton;

do $$
declare f rf04_c_fixture; u uuid; ced text; today date := (clock_timestamp() at time zone 'America/Guayaquil')::date;
begin
  select * into f from rf04_c_fixture;
  foreach u in array array[f.student,f.instructor,f.empty_instructor,f.admin] loop
    loop
      ced := lpad(floor(random()*10000000000)::bigint::text,10,'0');
      exit when not exists(select 1 from public.users where cedula=ced);
    end loop;
    insert into auth.users(id) values(u);
    insert into public.users(id,cedula,nombre_completo,rol) values(u,ced,'Fixture RF04C '||u::text,
      case when u=f.admin then 'admin'::public.user_role
        when u=f.student then 'estudiante'::public.user_role else 'instructor'::public.user_role end);
  end loop;
  insert into public.courses(id,nombre,tipo) values(f.course,'Fixture RF04C','A');
  insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,
    fecha_inicio_matricula,fecha_fin_matricula) values(f.cohort,f.course,'Fixture RF04C '||f.cohort::text,
      100,10,today-30,today+20,today-60,today-31);
  insert into public.enrollments(id,student_id,cohort_id,status,monto_total,horas_practica_objetivo)
    values(f.enrollment,f.student,f.cohort,'activo',100,10);
  insert into public.practice_slots(id,cohort_id,instructor_id,student_id,scheduled_at,status)
    select slot,f.cohort,f.instructor,f.student,clock_timestamp()-make_interval(hours=>n*2+1),'completado'
    from rf04_c_slots;
end $$;
grant select on rf04_c_fixture,rf04_c_slots to service_role;
set local role service_role;

do $$
declare f rf04_c_fixture; s record; result jsonb; expected jsonb; other_page jsonb; empty_detail jsonb;
  v_count bigint; weighted numeric; percentages numeric;
begin
  select * into f from rf04_c_fixture;
  for s in select * from rf04_c_slots order by n loop
    perform public.register_practice_attendance(s.slot,f.instructor,true);
    perform public.submit_practice_rating(s.slot,f.student,s.score,
      case when s.n=7 then 'Esta respuesta sera anulada' when s.n=1 then 'Buen trato' else null end);
  end loop;
  result := public.admin_instructor_rating_detail(f.admin,f.instructor,1,1);
  if (result->>'responses')::int<>7 then raise exception 'Fixture inicial incompleto'; end if;

  -- Correccion real: conserva la fila y la excluye del promedio y del desglose.
  perform public.correct_practice_attendance((select slot from rf04_c_slots where n=7),f.admin,false,
    'Se verifico la inasistencia real del fixture');
  if not exists(select 1 from public.practice_ratings where practice_slot_id=(select slot from rf04_c_slots where n=7)
    and invalidated_at is not null) then raise exception 'Falta anulacion del fixture'; end if;

  result := public.admin_instructor_rating_detail(f.admin,f.instructor,1,1);
  expected := '[{"stars":5,"count":3,"percentage":50},{"stars":4,"count":1,"percentage":16.67},
    {"stars":3,"count":0,"percentage":0},{"stars":2,"count":1,"percentage":16.67},
    {"stars":1,"count":1,"percentage":16.67}]'::jsonb;
  if result->'distribution' is distinct from expected or (result->>'average')::numeric<>3.67
    or (result->>'responses')::int<>6 or (result->>'total')::int<>6
    or not (result->>'rankingEligible')::boolean or result->'label'<>'null'::jsonb
    or jsonb_array_length(result->'items')<>1 then
    raise exception 'Desglose, promedio o pagina incorrectos: %',result; end if;
  select sum((x->>'count')::bigint),round(sum((x->>'stars')::numeric*(x->>'count')::numeric)
    /nullif(sum((x->>'count')::numeric),0),2),sum((x->>'percentage')::numeric)
    into v_count,weighted,percentages from jsonb_array_elements(result->'distribution') x;
  if v_count<>(result->>'responses')::bigint or weighted<>(result->>'average')::numeric
    or abs(percentages-100)>0.02 then raise exception 'Sumas del desglose no cuadran'; end if;

  other_page := public.admin_instructor_rating_detail(f.admin,f.instructor,2,2);
  if other_page->'distribution' is distinct from expected or jsonb_array_length(other_page->'items')<>2 then
    raise exception 'El desglose depende de la pagina'; end if;
  other_page := public.admin_instructor_rating_detail(f.admin,f.instructor,100,1);
  if other_page->'distribution' is distinct from expected or other_page->'items'<>'[]'::jsonb then
    raise exception 'Pagina vacia perdio el desglose completo'; end if;

  -- La respuesta no se reactiva tras volver a marcar asistencia true.
  perform public.correct_practice_attendance((select slot from rf04_c_slots where n=7),f.admin,true,
    'La revision final confirma asistencia del fixture');
  other_page := public.admin_instructor_rating_detail(f.admin,f.instructor,1,100);
  if other_page->'distribution' is distinct from expected
    or exists(select 1 from jsonb_array_elements(other_page->'items') x where (x->>'score')::int=3) then
    raise exception 'Anulada reaparecio en el detalle'; end if;

  -- Lista cerrada de claves publicas en todos los niveles; no alumno, franja, fecha ni IDs de respuesta.
  if exists(select 1 from jsonb_object_keys(other_page) k where k not in
    ('instructorId','average','responses','rankingEligible','label','distribution','items','total','page','pageSize'))
    or exists(select 1 from jsonb_array_elements(other_page->'items') x,
      lateral jsonb_object_keys(x) k where k not in ('score','comment'))
    or exists(select 1 from jsonb_array_elements(other_page->'distribution') x,
      lateral jsonb_object_keys(x) k where k not in ('stars','count','percentage')) then
    raise exception 'Detalle publico contiene metadatos privados'; end if;

  empty_detail := public.admin_instructor_rating_detail(f.admin,f.empty_instructor);
  if empty_detail->'average'<>'null'::jsonb or (empty_detail->>'responses')::int<>0
    or (empty_detail->>'total')::int<>0 or (empty_detail->>'rankingEligible')::boolean
    or empty_detail->>'label'<>'pocas calificaciones' or empty_detail->'items'<>'[]'::jsonb
    or jsonb_array_length(empty_detail->'distribution')<>5
    or (select jsonb_agg((x->>'stars')::int order by ordinality)
      from jsonb_array_elements(empty_detail->'distribution') with ordinality a(x,ordinality))<>'[5,4,3,2,1]'::jsonb
    or exists(select 1 from jsonb_array_elements(empty_detail->'distribution') x
      where (x->>'count')::int<>0 or (x->>'percentage')::numeric<>0) then
    raise exception 'Instructor vacio sin cinco estrellas en cero'; end if;

  begin perform public.admin_instructor_rating_detail(f.student,f.instructor);
    raise exception 'Alumno accedio'; exception when sqlstate 'RT403' then null; end;
  begin perform public.admin_instructor_rating_detail(f.instructor,f.instructor);
    raise exception 'Instructor accedio'; exception when sqlstate 'RT403' then null; end;
  begin perform public.admin_instructor_rating_detail(f.admin,gen_random_uuid());
    raise exception 'Instructor inexistente aceptado'; exception when sqlstate 'RT404' then null; end;
  begin perform public.admin_instructor_rating_detail(f.admin,f.instructor,0,20);
    raise exception 'Pagina invalida aceptada'; exception when sqlstate '22023' then null; end;
end $$;
reset role;

do $$
declare p record;
begin
  select * into p from pg_proc where oid='public.admin_instructor_rating_detail(uuid,uuid,integer,integer)'::regprocedure;
  if p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
    or not has_function_privilege('service_role',p.oid,'EXECUTE')
    or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
    or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee not in (p.proowner,(select oid from pg_roles where rolname='service_role'))) then
    raise exception 'Seguridad o permisos cambiaron'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform public.admin_instructor_rating_detail(null,null);
    raise exception 'anon ejecuto RPC'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.admin_instructor_rating_detail(null,null);
    raise exception 'authenticated ejecuto RPC'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
