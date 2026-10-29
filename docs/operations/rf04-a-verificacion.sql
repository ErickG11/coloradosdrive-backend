-- SQL Editor, ejecutar ENTERO despues de 035. Fixtures nuevos, sin datos reales.
-- El corte se adelanta SOLO dentro de esta transaccion para ensayar el reloj sin esperar dias.
-- No modifica/inhabilita triggers. No SMTP ni Broadcast. ROLLBACK restaura TODO, incluido el corte.
begin;
set local lock_timeout = '5s';
create temp table rf04_fixture (
  student uuid, other_student uuid, instructor uuid, few_instructor uuid, admin uuid,
  course uuid, cohort uuid, enrollment uuid, other_enrollment uuid,
  valid_slot uuid, second_slot uuid, third_slot uuid, few_slot uuid,
  blank_slot uuid, absent_slot uuid, expired_slot uuid, early_slot uuid,
  historical_slot uuid, future_slot uuid, atomic_slot uuid
) on commit drop;
insert into rf04_fixture select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
-- Privilegio del propietario del SQL Editor; service_role no puede mover este corte.
update private.practice_rating_rollout set enabled_at = clock_timestamp() - interval '10 days' where singleton;

do $$
declare f rf04_fixture; u uuid; ced text; today date := (clock_timestamp() at time zone 'America/Guayaquil')::date;
begin
  select * into f from rf04_fixture;
  foreach u in array array[f.student,f.other_student,f.instructor,f.few_instructor,f.admin] loop
    loop
      ced := lpad(floor(random()*10000000000)::bigint::text,10,'0');
      exit when not exists(select 1 from public.users where cedula = ced);
    end loop;
    insert into auth.users(id) values(u);
    insert into public.users(id,cedula,nombre_completo,rol) values(u,ced,'Fixture RF04 ' || u::text,
      case when u = f.admin then 'admin'::public.user_role
        when u in (f.instructor,f.few_instructor) then 'instructor'::public.user_role else 'estudiante'::public.user_role end);
  end loop;
  insert into public.courses(id,nombre,tipo) values(f.course,'Fixture RF04','A');
  insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,
    fecha_inicio_matricula,fecha_fin_matricula) values(f.cohort,f.course,'Fixture RF04 '||f.cohort::text,
      100,10,today-30,today+20,today-60,today-31);
  insert into public.enrollments(id,student_id,cohort_id,status,monto_total,horas_practica_objetivo)
    values(f.enrollment,f.student,f.cohort,'activo',100,10),
      (f.other_enrollment,f.other_student,f.cohort,'activo',100,10);
  insert into public.practice_slots(id,cohort_id,instructor_id,student_id,scheduled_at,status) values
    (f.valid_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '3 hours','completado'),
    (f.second_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '5 hours','completado'),
    (f.third_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '7 hours','completado'),
    (f.few_slot,f.cohort,f.few_instructor,f.student,clock_timestamp()-interval '15 hours','completado'),
    (f.blank_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '9 hours','completado'),
    (f.absent_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '11 hours','completado'),
    (f.expired_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '30 hours','completado'),
    (f.early_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '61 minutes','completado'),
    (f.historical_slot,f.cohort,f.instructor,f.student,
      (select enabled_at-interval '60 minutes' from private.practice_rating_rollout where singleton),'completado'),
    (f.future_slot,f.cohort,f.instructor,f.student,clock_timestamp()+interval '24 hours','asignado'),
    (f.atomic_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '13 hours','completado');
end $$;
grant select on rf04_fixture to service_role;
set local role service_role;

do $$
declare f rf04_fixture; result jsonb; result2 jsonb; e public.practice_attendance_events;
  r public.practice_ratings; pos_eligible bigint; pos_few bigint; op jsonb; old_count bigint;
begin
  select * into f from rf04_fixture;
  -- Propiedad, rol, cuenta, estado, escala, comentario y ausencia de asistencia.
  begin perform public.submit_practice_rating(f.valid_slot,f.other_student,4);
    raise exception 'Se acepto practica ajena'; exception when sqlstate 'RT404' then null; end;
  begin perform public.submit_practice_rating(f.valid_slot,f.instructor,4);
    raise exception 'Instructor califico'; exception when sqlstate 'RT403' then null; end;
  begin
    update public.users set activo=false where id=f.student;
    perform public.submit_practice_rating(f.valid_slot,f.student,4);
    raise exception 'Cuenta inactiva califico'; exception when sqlstate 'RT403' then null;
  end;
  begin perform public.submit_practice_rating(f.valid_slot,f.student,1.5);
    raise exception 'Score fraccionario'; exception when invalid_parameter_value then null; end;
  begin perform public.submit_practice_rating(f.valid_slot,f.student,0);
    raise exception 'Score fuera de escala'; exception when invalid_parameter_value then null; end;
  begin perform public.submit_practice_rating(f.valid_slot,f.student,6);
    raise exception 'Score fuera de escala'; exception when invalid_parameter_value then null; end;
  begin perform public.submit_practice_rating(f.valid_slot,f.student,4,repeat('x',1001));
    raise exception 'Comentario demasiado largo'; exception when invalid_parameter_value then null; end;
  begin perform public.submit_practice_rating(f.valid_slot,f.student,4);
    raise exception 'Sin asistencia califico'; exception when sqlstate 'RT412' then null; end;
  begin perform public.submit_practice_rating(f.future_slot,f.student,4);
    raise exception 'Practica futura califico'; exception when sqlstate 'RT412' then null; end;
  perform public.register_practice_attendance(f.absent_slot,f.instructor,false);
  begin perform public.submit_practice_rating(f.absent_slot,f.student,4);
    raise exception 'Inasistente califico'; exception when sqlstate 'RT412' then null; end;
  perform public.register_practice_attendance(f.historical_slot,f.instructor,true);
  if exists(select 1 from public.notifications where practice_slot_id=f.historical_slot and tipo='encuesta_practica')
    or exists(select 1 from public.practice_slots where id=f.historical_slot and rating_window_opens_at is not null) then
    raise exception 'Se habilito encuesta retroactiva'; end if;
  begin perform public.submit_practice_rating(f.historical_slot,f.student,4);
    raise exception 'Practica historica califico'; exception when sqlstate 'RT412' then null; end;
  perform public.register_practice_attendance(f.early_slot,f.instructor,true);
  if not exists(select 1 from public.practice_slots where id=f.early_slot
    and rating_window_opens_at=scheduled_at+make_interval(mins=>duration_minutes)+interval '5 minutes') then
    raise exception 'No se respeto fin+5'; end if;
  begin perform public.submit_practice_rating(f.early_slot,f.student,4);
    raise exception 'Califico antes de fin+5'; exception when sqlstate 'RT412' then null; end;

  -- Evento auditado historico SOLO para fixture: permite ensayar 24h vencidas sin esperar.
  insert into public.practice_attendance_events(slot_id,student_id,instructor_id,cohort_id,scheduled_at,
    duration_minutes,actor_id,actor_role,created_at,tipo,previous_attended,new_attended)
    select id,student_id,instructor_id,cohort_id,scheduled_at,duration_minutes,instructor_id,'instructor',
      clock_timestamp()-interval '25 hours','registro',null,true from public.practice_slots where id=f.expired_slot
    returning * into e;
  update public.practice_slots set attended=true,rating_window_opens_at=e.created_at where id=f.expired_slot;
  begin perform public.submit_practice_rating(f.expired_slot,f.student,4);
    raise exception 'Califico fuera de 24h'; exception when sqlstate 'RT410' then null; end;

  perform public.register_practice_attendance(f.valid_slot,f.instructor,true);
  perform public.register_practice_attendance(f.second_slot,f.instructor,true);
  perform public.register_practice_attendance(f.third_slot,f.instructor,true);
  perform public.register_practice_attendance(f.few_slot,f.few_instructor,true);
  if not exists(select 1 from public.practice_slots s join public.practice_attendance_events a on a.slot_id=s.id
    where s.id=f.valid_slot and a.tipo='registro' and s.rating_window_opens_at=a.created_at) then
    raise exception 'Registro tardio no usa fecha auditada'; end if;
  if (select count(*) from public.notifications where practice_slot_id=f.valid_slot and tipo='encuesta_practica'
    and email_status is null and attendance_event_id is null)<>1 then raise exception 'Falta aviso atomico de encuesta'; end if;
end $$;
-- Consultar pendientes despues del registro, como hara la API.
do $$
declare f rf04_fixture; result jsonb; r public.practice_ratings; pos_eligible bigint; pos_few bigint;
begin
  select * into f from rf04_fixture;
  result := public.list_student_pending_practice_ratings(f.student,1,100);
  if (result->>'total')::int<>4 then raise exception 'Pendientes incorrectos: %', result; end if;
  result := public.submit_practice_rating(f.valid_slot,f.student,1,E'\t Buen trato \n');
  if result->>'comment'<>'Buen trato' or (result->>'score')::int<>1 then raise exception 'Envio invalido'; end if;
  begin perform public.submit_practice_rating(f.valid_slot,f.student,5);
    raise exception 'Doble envio aceptado'; exception when sqlstate 'RT409' then null; end;
  begin
    insert into public.practice_ratings(practice_slot_id,student_id,instructor_id,score)
      values(f.valid_slot,f.student,f.instructor,5);
    raise exception 'INSERT duplicado aceptado'; exception when sqlstate 'RT409' then null; end;
  if (select count(*) from public.practice_ratings where practice_slot_id=f.valid_slot)<>1 then raise exception 'UNIQUE roto'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.practice_ratings'::regclass
    and conname='practice_ratings_one_per_practice' and contype='u') then raise exception 'Falta UNIQUE fisico'; end if;
  perform public.submit_practice_rating(f.second_slot,f.student,2,'');
  perform public.submit_practice_rating(f.third_slot,f.student,3);
  perform public.submit_practice_rating(f.few_slot,f.student,5,repeat('x',1000));
  result := public.list_admin_instructor_ratings(f.admin,1,100);
  select ordinality into pos_eligible from jsonb_array_elements(result->'items') with ordinality
    where value->>'instructorId'=f.instructor::text;
  select ordinality into pos_few from jsonb_array_elements(result->'items') with ordinality
    where value->>'instructorId'=f.few_instructor::text;
  -- No depende del resto de instructores reales de la base; fixtures identificados por UUID.
  if pos_eligible is null or pos_few is null or pos_eligible>=pos_few then raise exception 'Elegibles no se ordenan primero'; end if;
  result := public.admin_instructor_rating_detail(f.admin,f.instructor,1,1);
  if (result->>'average')::numeric<>2 or (result->>'responses')::int<>3
    or not (result->>'rankingEligible')::boolean or jsonb_array_length(result->'items')<>1 then
    raise exception 'Promedio o minimo incorrecto: %',result; end if;
  if exists(select 1 from jsonb_object_keys(result->'items'->0) k where k not in ('score','comment')) then
    raise exception 'Detalle permite identificar al alumno'; end if;
  result := public.admin_instructor_rating_detail(f.admin,f.few_instructor);
  if (result->>'average')::numeric<>5 or (result->>'responses')::int<>1 or (result->>'rankingEligible')::boolean
    or result->>'label'<>'pocas calificaciones' then raise exception 'Pocas respuestas ocultaron promedio'; end if;
  begin perform public.list_admin_instructor_ratings(f.instructor);
    raise exception 'Instructor vio ranking'; exception when sqlstate 'RT403' then null; end;
  begin perform public.admin_instructor_rating_detail(f.student,f.instructor);
    raise exception 'Alumno vio detalle'; exception when sqlstate 'RT403' then null; end;
  begin update public.practice_slots set rating_window_opens_at=clock_timestamp() where id=f.valid_slot;
    raise exception 'Se movio ventana sin evento'; exception when sqlstate 'RT403' then null; end;
  begin update public.practice_ratings set score=5 where practice_slot_id=f.valid_slot;
    raise exception 'Respuesta editable'; exception when insufficient_privilege then null; end;
  begin delete from public.practice_ratings where practice_slot_id=f.valid_slot;
    raise exception 'Respuesta eliminable fuera del flujo'; exception when sqlstate 'RT403' then null; end;

  perform public.correct_practice_attendance(f.third_slot,f.instructor,false,'Se verifico la inasistencia real');
  select * into r from public.practice_ratings where practice_slot_id=f.third_slot;
  if r.invalidated_at is null or r.invalidation_reason<>'Se verifico la inasistencia real' or r.invalidation_event_id is null then
    raise exception 'Falta anulacion auditada'; end if;
  result := public.admin_instructor_rating_detail(f.admin,f.instructor,1,100);
  if (result->>'average')::numeric<>1.5 or (result->>'responses')::int<>2 or (result->>'rankingEligible')::boolean
    or exists(select 1 from jsonb_array_elements(result->'items') x where (x->>'score')::int=3) then
    raise exception 'Anulada sigue en detalle/promedio'; end if;
  perform public.correct_practice_attendance(f.third_slot,f.admin,true,'La revision final confirma asistencia');
  if (select invalidated_at from public.practice_ratings where practice_slot_id=f.third_slot) is distinct from r.invalidated_at then
    raise exception 'Se reactivo calificacion anulada'; end if;
  begin perform public.submit_practice_rating(f.third_slot,f.student,5);
    raise exception 'Segunda encuesta tras anulacion'; exception when sqlstate 'RT409' then null; end;
  -- Una correccion tardia a true abre 24h nuevas para quien nunca respondio.
  perform public.correct_practice_attendance(f.expired_slot,f.admin,false,'Primera revision de asistencia tardia');
  perform public.correct_practice_attendance(f.expired_slot,f.admin,true,'Revision final confirma la asistencia');
  if not exists(select 1 from public.practice_slots s join public.practice_attendance_events a on a.slot_id=s.id
    where s.id=f.expired_slot and a.tipo='correccion' and a.new_attended
      and s.rating_window_opens_at=a.created_at and a.created_at>clock_timestamp()-interval '1 minute') then
    raise exception 'Correccion no renovo fecha'; end if;
  perform public.submit_practice_rating(f.expired_slot,f.student,4);
end $$;
reset role;

-- Fallo simulado de bandeja: no debe persistir asistencia, ventana ni evento.
create function pg_temp.rf04_fail_inbox() returns trigger language plpgsql as $$
begin if new.tipo='encuesta_practica' then raise exception 'RF04_FIXTURE_INBOX'; end if; return new; end $$;
create trigger rf04_fixture_fail_inbox before insert on public.notifications
  for each row execute function pg_temp.rf04_fail_inbox();
set local role service_role;
do $$ declare f rf04_fixture; n bigint; begin
  select * into f from rf04_fixture;
  select count(*) into n from public.practice_attendance_events where slot_id=f.atomic_slot;
  begin perform public.register_practice_attendance(f.atomic_slot,f.instructor,true);
    raise exception 'No fallo la bandeja'; exception when raise_exception then
      if sqlerrm<>'RF04_FIXTURE_INBOX' then raise; end if; end;
  if exists(select 1 from public.practice_slots where id=f.atomic_slot and (attended is not null or rating_window_opens_at is not null))
    or (select count(*) from public.practice_attendance_events where slot_id=f.atomic_slot)<>n then
    raise exception 'Bandeja fallo y dejo estado parcial'; end if;
end $$;
reset role;
drop trigger rf04_fixture_fail_inbox on public.notifications;

-- Fallo simulado de anulacion: debe deshacer tambien evento, asistencia y aviso E4.
create function pg_temp.rf04_fail_invalidation() returns trigger language plpgsql as $$
begin raise exception 'RF04_FIXTURE_INVALIDATION'; end $$;
create trigger rf04_fixture_fail_invalidation before update on public.practice_ratings
  for each row execute function pg_temp.rf04_fail_invalidation();
set local role service_role;
do $$ declare f rf04_fixture; n bigint; begin
  select * into f from rf04_fixture;
  select count(*) into n from public.practice_attendance_events where slot_id=f.valid_slot;
  begin perform public.correct_practice_attendance(f.valid_slot,f.instructor,false,'Correccion con fallo de anulacion');
    raise exception 'No fallo anulacion'; exception when raise_exception then
      if sqlerrm<>'RF04_FIXTURE_INVALIDATION' then raise; end if; end;
  if not (select attended from public.practice_slots where id=f.valid_slot)
    or exists(select 1 from public.practice_ratings where practice_slot_id=f.valid_slot and invalidated_at is not null)
    or (select count(*) from public.practice_attendance_events where slot_id=f.valid_slot)<>n then
    raise exception 'Anulacion fallo y dejo estado parcial'; end if;
end $$;
reset role;
drop trigger rf04_fixture_fail_invalidation on public.practice_ratings;

-- ACL/RLS: consultas reales como anon/authenticated y privilegios de todas las RPC nuevas.
do $$ declare role_name text; privilege text; sig text; begin
  if not (select relrowsecurity from pg_class where oid='public.practice_ratings'::regclass)
    or exists(select 1 from pg_policy where polrelid='public.practice_ratings'::regclass) then raise exception 'RLS incorrecta'; end if;
  foreach role_name in array array['anon','authenticated'] loop
    foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(role_name,'public.practice_ratings',privilege) then raise exception 'ACL excesiva: % %',role_name,privilege; end if;
    end loop;
    foreach sig in array array['public.submit_practice_rating(uuid,uuid,numeric,text)',
      'public.list_student_pending_practice_ratings(uuid,integer,integer)',
      'public.list_admin_instructor_ratings(uuid,integer,integer)',
      'public.admin_instructor_rating_detail(uuid,uuid,integer,integer)',
      'private.lock_rateable_practice(uuid,uuid)','private.guard_practice_rating()','private.guard_practice_rating_window()'] loop
      if has_function_privilege(role_name,sig,'execute') then raise exception 'RPC publica: % %',role_name,sig; end if;
    end loop;
  end loop;
  if has_table_privilege('service_role','private.practice_rating_rollout','UPDATE')
    or has_column_privilege('service_role','public.practice_ratings','score','UPDATE') then raise exception 'ACL interna excesiva'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform 1 from public.practice_ratings; raise exception 'anon leyo'; exception when insufficient_privilege then null; end;
  begin perform public.list_admin_instructor_ratings(null); raise exception 'anon ejecuto RPC'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform 1 from public.practice_ratings; raise exception 'authenticated leyo'; exception when insufficient_privilege then null; end;
  begin perform public.submit_practice_rating(null,null,5); raise exception 'authenticated ejecuto RPC'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Flujo real D: CAS/fase, guard contra nuevas calificaciones, limpieza antes de FKs.
set local role service_role;
do $$ declare f rf04_fixture; op jsonb; ced text; n bigint; begin
  select * into f from rf04_fixture;
  select cedula into ced from public.users where id=f.student;
  select count(*) into n from public.practice_attendance_events where student_id=f.student;
  op := public.begin_student_deletion(f.admin,f.student,ced);
  op := public.advance_student_deletion(f.admin,f.student,'bloqueo',(op->>'updated_at')::timestamptz,'storage');
  begin perform public.submit_practice_rating(f.blank_slot,f.student,5);
    raise exception 'Alumno en eliminacion califico'; exception when sqlstate 'RT403' then null; end;
  begin
    insert into public.practice_ratings(practice_slot_id,student_id,instructor_id,score)
      values(f.blank_slot,f.student,f.instructor,5);
    raise exception 'INSERT evadio guard D'; exception when sqlstate 'CD030' then null; end;
  op := public.delete_student_data(f.admin,f.student,(op->>'updated_at')::timestamptz,array[]::text[]);
  if op->>'phase'<>'auth' or exists(select 1 from public.practice_ratings where student_id=f.student)
    or exists(select 1 from public.users where id=f.student) then raise exception 'Eliminacion bloqueada o incompleta'; end if;
  if (select count(*) from public.practice_attendance_events where student_id=f.student)<>n then
    raise exception 'Se elimino auditoria E4'; end if;
  if not exists(select 1 from public.practice_slots where id=f.future_slot and student_id is null and status='liberado') then
    raise exception 'Cambio el comportamiento de D'; end if;
  if exists(select 1 from public.notifications where user_id=f.student) then raise exception 'Bandeja no limpiada por FK'; end if;
  op := public.admin_instructor_rating_detail(f.admin,f.instructor);
  if (op->>'responses')::int<>0 or op->'average'<>'null'::jsonb or op->'items'<>'[]'::jsonb then
    raise exception 'Eliminacion no actualizo el agregado'; end if;
  select to_jsonb(o) into op from public.student_deletion_operations o where student_id=f.student;
  op := public.delete_student_data(f.admin,f.student,(op->>'updated_at')::timestamptz,array[]::text[]);
  if op->>'phase'<>'auth' then raise exception 'Se rompio idempotencia de D'; end if;
end $$;
reset role;
select 'RF04 A: verificaciones correctas; se revierte toda la transaccion' as resultado;
rollback;
