-- Ejecutado por run.mjs, únicamente en la base desechable marcada y vacía.
begin;
set local timezone = 'America/Guayaquil';
create function pg_temp.expect_sqlstate(p_sql text, p_state text) returns void language plpgsql as $$
declare caught boolean := false;
begin
  begin execute p_sql;
  exception when others then
    caught := true;
    if sqlstate <> p_state then raise; end if;
  end;
  if not caught then raise exception 'Se esperaba SQLSTATE % para %', p_state, p_sql; end if;
end; $$;

do $$
declare
  teacher uuid := '10000000-0000-4000-8000-000000000001';
  teacher2 uuid := '10000000-0000-4000-8000-000000000002';
  cohort uuid := '30000000-0000-4000-8000-000000000001';
  student1 uuid := '20000000-0000-4000-8000-000000000001';
  student2 uuid := '20000000-0000-4000-8000-000000000002';
  outsider uuid := '20000000-0000-4000-8000-000000000003';
  first_id uuid; adjacent_id uuid; target uuid; cancel_id uuid; changed public.practice_slots;
  version text; n integer; start_at timestamptz; close_at timestamptz;
begin
  insert into public.practice_slots(cohort_id, instructor_id, scheduled_at)
    values (cohort, teacher, '2035-03-01T08:00:00Z') returning id into first_id;
  insert into public.practice_slots(cohort_id, instructor_id, scheduled_at)
    values (cohort, teacher, '2035-03-01T09:00:00Z') returning id into adjacent_id;
  insert into public.practice_slots(cohort_id, instructor_id, scheduled_at)
    values (cohort, teacher2, '2035-03-01T08:30:00Z');
  -- Parcial por ambas puntas, completo, contiguo e instructores distintos.
  perform pg_temp.expect_sqlstate(format('insert into public.practice_slots(cohort_id,instructor_id,scheduled_at) values (%L,%L,%L)', cohort, teacher, '2035-03-01T08:30:00Z'), '23P01');
  perform pg_temp.expect_sqlstate(format('insert into public.practice_slots(cohort_id,instructor_id,scheduled_at) values (%L,%L,%L)', cohort, teacher, '2035-03-01T07:30:00Z'), '23P01');
  perform pg_temp.expect_sqlstate(format('insert into public.practice_slots(cohort_id,instructor_id,scheduled_at) values (%L,%L,%L)', cohort, teacher, '2035-03-01T08:00:00Z'), '23P01');
  perform pg_temp.expect_sqlstate(format('update public.practice_slots set scheduled_at=%L where id=%L', '2035-03-01T08:30:00Z', adjacent_id), '23P01');
  perform pg_temp.expect_sqlstate(format('update public.practice_slots set instructor_id=%L where instructor_id=%L', teacher, teacher2), '23P01');
  perform pg_temp.expect_sqlstate(format('update public.practice_slots set duration_minutes=45 where id=%L', first_id), '23514');
  perform pg_temp.expect_sqlstate(format('insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,duration_minutes) values (%L,%L,%L,90)', cohort, teacher, '2035-03-01T12:00:00Z'), '23514');
  perform pg_temp.expect_sqlstate(format('insert into public.practice_slots(cohort_id,instructor_id,scheduled_at) values (%L,%L,%L)', cohort, teacher, 'infinity'), '23514');
  if (select duration_minutes from public.practice_slots where id=first_id) <> 60 then raise exception 'default != 60'; end if;

  update public.practice_slots set status='liberado' where id=first_id;
  -- 07:30 solo se solapa con liberado; la franja contigua de 09:00 no oculta el fallo.
  perform pg_temp.expect_sqlstate(format('insert into public.practice_slots(cohort_id,instructor_id,scheduled_at) values (%L,%L,%L)', cohort, teacher, '2035-03-01T07:30:00Z'), '23P01');
  select count(*) into n from public.practice_free_instructors(array['2035-03-01T07:30:00Z'::timestamptz], teacher);
  if n <> 0 then raise exception 'liberado/solapamiento parcial no bloqueó disponibilidad'; end if;
  select count(*) into n from public.practice_free_instructors(array['2035-03-01T10:00:00Z'::timestamptz], teacher);
  if n <> 1 then raise exception 'intervalo contiguo no disponible'; end if;
  update public.practice_slots set status='sin_practica' where id=first_id;
  select count(*) into n from public.practice_free_instructors(array['2035-03-01T08:00:00Z'::timestamptz], teacher);
  if n <> 1 then raise exception 'sin_practica bloquea incorrectamente'; end if;

  start_at := clock_timestamp() + interval '10 minutes'; close_at := start_at - interval '5 minutes';
  if not public.practice_slot_window_open(start_at, close_at - interval '1 microsecond')
      or public.practice_slot_window_open(start_at, close_at)
      or public.practice_slot_window_open(start_at, close_at + interval '1 microsecond') then
    raise exception 'límite estricto antes/exactamente/después de closeAt incorrecto';
  end if;
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at)
    values(cohort,teacher,start_at) returning id into target;
  perform pg_temp.expect_sqlstate(format('select * from public.act_on_practice_slot(%L,%L,%L)', target, outsider, 'claim'), 'CD403');
  select * into changed from public.act_on_practice_slot(target,student1,'claim');
  if changed.student_id <> student1 or changed.status <> 'asignado' then raise exception 'claim válido falló'; end if;
  perform pg_temp.expect_sqlstate(format('select * from public.act_on_practice_slot(%L,%L,%L)', target, student2, 'confirm'), 'CD404');
  if public.practice_slot_transition_due(changed, 'close', close_at - interval '1 microsecond')
      or not public.practice_slot_transition_due(changed, 'close', close_at)
      or not public.practice_slot_transition_due(changed, 'close', close_at + interval '1 microsecond')
      or public.practice_slot_transition_due(changed, 'remind', close_at) then raise exception 'scheduler no coincide con closeAt'; end if;
  if public.practice_slot_transition_due(changed, 'remind', start_at - interval '21 minutes')
      or not public.practice_slot_transition_due(changed, 'remind', start_at - interval '20 minutes')
      or not public.practice_slot_transition_due(changed, 'remind', close_at - interval '1 microsecond') then
    raise exception 'recordatorio fuera del rango 20 a 5 minutos';
  end if;

  -- Versión stale tras cancelar/reclamar: incluso con estado asignado otra vez.
  select row_version into version from public.practice_slots_scheduler_candidates('remind') where slot->>'id'=target::text;
  perform public.act_on_practice_slot(target,student1,'cancel');
  select * into changed from public.act_on_practice_slot(target,student2,'claim');
  if changed.confirmed_at is not null or changed.confirmation_notified_at is not null
    or changed.release_notified_at is not null then raise exception 'ciclo heredado'; end if;
  -- Esta sección comparte una transacción: xmin no cambia dentro de ella.
  -- La carrera real en transacciones separadas se prueba en run.mjs.
  select * into changed from public.act_on_practice_slot(target,student2,'confirm');
  if public.practice_slot_transition_due(changed,'complete',start_at + interval '59 minutes')
     or not public.practice_slot_transition_due(changed,'complete',start_at + interval '60 minutes') then raise exception 'fin no usa 60 minutos'; end if;
  perform public.act_on_practice_slot(target,student2,'cancel');
  update public.practice_slots set scheduled_at=clock_timestamp()+interval '4 minutes' where id=target;
  perform pg_temp.expect_sqlstate(format('select * from public.act_on_practice_slot(%L,%L,%L)', target, student1, 'claim'), 'CD409');
  update public.practice_slots set status='asignado', student_id=student1 where id=target;
  perform pg_temp.expect_sqlstate(format('select * from public.act_on_practice_slot(%L,%L,%L)', target, student1, 'confirm'), 'CD409');
  perform public.act_on_practice_slot(target,student1,'cancel'); -- Sin límite nuevo.
  select xmin::text into version from public.practice_slots where id=target;
  select count(*) into n from public.transition_practice_slot_for_scheduler(target,'close',version);
  if n <> 1 then raise exception 'cierre vencido no aplicado'; end if;
  select count(*) into n from public.transition_practice_slot_for_scheduler(target,'close',version);
  if n <> 0 then raise exception 'cierre repetido aplicado'; end if;

  update public.practice_slots set status='confirmado', student_id=student1,
    scheduled_at=clock_timestamp()-interval '2 hours' where id=target;
  select xmin::text into version from public.practice_slots where id=target;
  select count(*) into n from public.transition_practice_slot_for_scheduler(target,'complete',version);
  if n <> 1 then raise exception 'finalización no aplicada'; end if;
  perform pg_temp.expect_sqlstate(format('insert into public.practice_slots(cohort_id,instructor_id,scheduled_at) select cohort_id,instructor_id,scheduled_at from public.practice_slots where id=%L', target), '23P01');

  -- Una franja histórica sigue cerrando o completándose tras desactivar.
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,status,student_id)
    values (cohort,teacher,clock_timestamp()-interval '4 hours','asignado',student1)
    returning id into first_id;
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,status,student_id)
    values (cohort,teacher,clock_timestamp()-interval '6 hours','confirmado',student1)
    returning id into adjacent_id;
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,status,student_id)
    values (cohort,teacher,clock_timestamp()-interval '8 hours','asignado',student1)
    returning id into cancel_id;
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,status,student_id)
    values (cohort,teacher,'2035-03-02T08:00:00Z','asignado',student1)
    returning id into target;
  perform pg_temp.expect_sqlstate(format('select public.set_instructor_active(%L,false)', teacher), 'CD024');
  update public.practice_slots set status='liberado',student_id=null where id=target;
  if not public.set_instructor_active(teacher,false) then raise exception 'desactivación falló'; end if;
  perform pg_temp.expect_sqlstate(format('insert into public.practice_slots(cohort_id,instructor_id,scheduled_at) values (%L,%L,%L)', cohort, teacher, '2035-03-01T12:00:00Z'), 'CD023');
  perform pg_temp.expect_sqlstate(format('update public.practice_slots set instructor_id=%L where instructor_id=%L and scheduled_at=%L', teacher, teacher2, '2035-03-01T08:30:00Z'), 'CD023');
  perform pg_temp.expect_sqlstate(format('select * from public.act_on_practice_slot(%L,%L,%L)', target, student1, 'claim'), 'CD023');
  perform public.act_on_practice_slot(cancel_id,student1,'cancel');
  if (select status from public.practice_slots where id=cancel_id) <> 'liberado'
    then raise exception 'instructor inactivo bloqueó cancel'; end if;
  select count(*) into n from public.practice_free_instructors(array['2035-03-01T12:00:00Z'::timestamptz],teacher);
  if n <> 0 then raise exception 'instructor inactivo aún aparece disponible'; end if;
  select xmin::text into version from public.practice_slots where id=first_id;
  select count(*) into n from public.transition_practice_slot_for_scheduler(first_id,'close',version);
  if n <> 1 or (select status from public.practice_slots where id=first_id) <> 'sin_practica'
    then raise exception 'instructor inactivo bloqueó close'; end if;
  select xmin::text into version from public.practice_slots where id=adjacent_id;
  select count(*) into n from public.transition_practice_slot_for_scheduler(adjacent_id,'complete',version);
  if n <> 1 or (select status from public.practice_slots where id=adjacent_id) <> 'completado'
    then raise exception 'instructor inactivo bloqueó complete'; end if;

  if has_function_privilege('anon','public.act_on_practice_slot(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.transition_practice_slot_for_scheduler(uuid,text,text)','EXECUTE') then
    raise exception 'RPC expuesta a un rol público';
  end if;
  if exists (select 1 from pg_proc where pronamespace='public'::regnamespace
    and proname in ('act_on_practice_slot','transition_practice_slot_for_scheduler') and prosecdef) then
    raise exception 'RPC eleva privilegios';
  end if;
end; $$;
rollback;
