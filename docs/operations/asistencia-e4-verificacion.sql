-- Ejecutar ENTERO despues de 034. Solo fixtures nuevos y ROLLBACK final.
-- Sin SMTP, Broadcast ni conexiones externas. Una sesion, no prueba carreras reales.
begin;
set local lock_timeout = '5s';
create temp table asistencia_e4_fixture (
  student uuid, other_student uuid, instructor uuid, other_instructor uuid, admin uuid,
  course uuid, cohort uuid, enrollment uuid, other_enrollment uuid,
  recent_slot uuid, old_slot uuid, pending_slot uuid, blank_slot uuid
) on commit drop;
insert into asistencia_e4_fixture select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
do $$
declare f asistencia_e4_fixture; u uuid; ced text; today date := (clock_timestamp() at time zone 'America/Guayaquil')::date;
begin
  select * into f from asistencia_e4_fixture;
  foreach u in array array[f.student,f.other_student,f.instructor,f.other_instructor,f.admin] loop
    loop
      ced := lpad(floor(random()*10000000000)::bigint::text,10,'0');
      exit when not exists(select 1 from public.users where cedula = ced);
    end loop;
    insert into auth.users(id) values(u);
    insert into public.users(id,cedula,nombre_completo,rol) values(u,ced,'Fixture E4 ' || u::text,
      case when u = f.admin then 'admin'::public.user_role
        when u in (f.instructor,f.other_instructor) then 'instructor'::public.user_role else 'estudiante'::public.user_role end);
  end loop;
  insert into public.courses(id,nombre,tipo) values(f.course,'Fixture E4','A');
  insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,
    fecha_inicio_matricula,fecha_fin_matricula) values(f.cohort,f.course,'Fixture E4 '||f.cohort::text,
      100,10,today-10,today+20,today-40,today-11);
  insert into public.enrollments(id,student_id,cohort_id,status,monto_total,horas_practica_objetivo)
    values(f.enrollment,f.student,f.cohort,'activo',100,10), (f.other_enrollment,f.other_student,f.cohort,'activo',100,10);
  insert into public.practice_slots(id,cohort_id,instructor_id,student_id,scheduled_at,status) values
    (f.recent_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '2 hours','completado'),
    (f.old_slot,f.cohort,f.instructor,f.student,clock_timestamp()-interval '60 hours','completado'),
    (f.pending_slot,f.cohort,f.instructor,f.student,clock_timestamp()+interval '24 hours','asignado'),
    (f.blank_slot,f.cohort,f.other_instructor,f.student,clock_timestamp()-interval '5 hours','completado');
end $$;
grant select on asistencia_e4_fixture to service_role;
set local role service_role;
do $$
declare f asistencia_e4_fixture; event_id uuid; result jsonb; before_count bigint;
  fixed timestamptz := '2026-10-26T15:00:00Z';
begin
  select * into f from asistencia_e4_fixture;
  if not private.attendance_correction_window_open(fixed,60,fixed+interval '49 hours')
    or private.attendance_correction_window_open(fixed,60,fixed+interval '49 hours 0.000001 seconds') then
    raise exception 'Limite exacto de 48 horas incorrecto'; end if;
  begin perform public.register_practice_attendance(f.recent_slot,f.other_instructor,true);
    raise exception 'Se admitio franja ajena'; exception when sqlstate 'AT404' then null; end;
  begin perform public.register_practice_attendance(f.recent_slot,f.student,true);
    raise exception 'Alumno registro asistencia'; exception when sqlstate 'AT403' then null; end;
  begin perform public.register_practice_attendance(f.recent_slot,f.admin,true);
    raise exception 'Admin uso registro de instructor'; exception when sqlstate 'AT403' then null; end;
  begin
    update public.users set activo=false where id=f.instructor;
    perform public.register_practice_attendance(f.recent_slot,f.instructor,true);
    raise exception 'Actor inactivo registro asistencia'; exception when sqlstate 'AT403' then null;
  end;
  begin perform public.register_practice_attendance(f.pending_slot,f.instructor,true);
    raise exception 'Se registro una futura'; exception when sqlstate 'AT413' then null; end;
  begin update public.practice_slots set attended = true where id = f.recent_slot;
    raise exception 'Se admitio UPDATE sin auditoria'; exception when sqlstate 'AT417' then null; end;
  begin insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status,attended)
    values(f.cohort,f.instructor,f.student,clock_timestamp()-interval '80 hours','completado',true);
    raise exception 'Se admitio INSERT con asistencia sin auditoria'; exception when sqlstate 'AT417' then null; end;
  perform public.register_practice_attendance(f.recent_slot,f.instructor,true);
  perform public.register_practice_attendance(f.old_slot,f.instructor,false);
  if not exists(select 1 from public.practice_attendance_events where slot_id=f.recent_slot
    and actor_id=f.instructor and actor_role='instructor' and tipo='registro'
    and previous_attended is null and new_attended and motivo is null) then raise exception 'Registro sin huella'; end if;
  if exists(select 1 from public.notifications where practice_slot_id=f.recent_slot) then raise exception 'Registro inicial creo aviso'; end if;
  begin perform public.register_practice_attendance(f.recent_slot,f.instructor,false);
    raise exception 'Se sobreescribio registro'; exception when sqlstate 'AT414' then null; end;
  begin perform public.correct_practice_attendance(f.old_slot,f.instructor,true,'Correccion fuera de plazo');
    raise exception 'Instructor corrigio fuera de ventana'; exception when sqlstate 'AT410' then null; end;
  begin perform public.correct_practice_attendance(f.blank_slot,f.other_instructor,true,'Aun no hay registro para corregir');
    raise exception 'Instructor corrigio un NULL'; exception when sqlstate 'AT415' then null; end;
  begin perform public.correct_practice_attendance(f.pending_slot,f.admin,true,'No se puede corregir una futura');
    raise exception 'Admin corrigio practica no completada'; exception when sqlstate 'AT413' then null; end;
  begin perform public.correct_practice_attendance(f.recent_slot,f.instructor,false,' corto ');
    raise exception 'Se admitio motivo corto'; exception when sqlstate 'AT412' then null; end;
  begin perform public.correct_practice_attendance(f.recent_slot,f.instructor,false,repeat('x',501));
    raise exception 'Se admitio motivo largo'; exception when sqlstate 'AT412' then null; end;
  begin perform public.correct_practice_attendance(f.recent_slot,f.instructor,false,E'\t\n corto \r\n');
    raise exception 'Se contaron bordes en blanco como motivo'; exception when sqlstate 'AT412' then null; end;
  begin perform public.correct_practice_attendance(f.recent_slot,f.instructor,true,'Mismo valor debe fallar');
    raise exception 'Se admitio mismo valor'; exception when sqlstate 'AT411' then null; end;
  perform public.correct_practice_attendance(f.recent_slot,f.instructor,false,E'\t Se marco por error al inicio \n');
  select id into event_id from public.practice_attendance_events where slot_id=f.recent_slot and tipo='correccion';
  perform private.enqueue_attendance_correction(event_id);
  perform private.enqueue_attendance_correction(event_id);
  if (select count(*) from public.notifications where attendance_event_id=event_id)<>1 then raise exception 'Aviso duplicado'; end if;
  if not exists(select 1 from public.practice_attendance_events where id=event_id and previous_attended
    and new_attended=false and motivo='Se marco por error al inicio') then raise exception 'Valores o motivo incorrectos'; end if;
  perform public.correct_practice_attendance(f.old_slot,f.admin,true,'Revision administrativa sin limite');
  perform public.correct_practice_attendance(f.blank_slot,f.admin,false,'Registro pendiente resuelto por admin');
  if not exists(select 1 from public.practice_attendance_events where slot_id=f.old_slot
    and actor_id=f.admin and actor_role='admin' and tipo='correccion' and previous_attended=false and new_attended) then
    raise exception 'No se guardo el actor/rol administrativo'; end if;
  result := public.list_practice_attendance_events(f.admin,f.recent_slot,1,1);
  if (result->>'total')::integer<>2 or jsonb_array_length(result->'items')<>1
    or result->'items'->0->>'tipo'<>'correccion' or result->'items'->0 ? 'transaction_id' then raise exception 'Auditoria paginada incorrecta'; end if;
  begin perform public.list_practice_attendance_events(f.instructor,f.recent_slot);
    raise exception 'Instructor leyo auditoria admin'; exception when sqlstate 'AT403' then null; end;
  begin perform public.student_practice_history(f.other_student,f.enrollment);
    raise exception 'Historial ajeno visible'; exception when sqlstate 'CD404' then null; end;
  begin perform public.student_practice_history(f.instructor,f.enrollment);
    raise exception 'Instructor leyo historial de alumno'; exception when sqlstate 'AT403' then null; end;
  begin update public.practice_attendance_events set motivo='Otra razon de prueba' where id=event_id;
    raise exception 'Se modifico auditoria'; exception when insufficient_privilege then null; end;
  begin delete from public.practice_attendance_events where id=event_id;
    raise exception 'Se elimino auditoria'; exception when insufficient_privilege then null; end;
  -- Instantaneas E1: falta es resultado de cancelacion, attended permanece NULL.
  insert into public.practice_slot_cancellations(slot_id,enrollment_id,student_id,instructor_id,cohort_id,
    slot_starts_at,cancelled_at,motivo_categoria,motivo_texto,resultado,consumio_reprogramacion) values
    (gen_random_uuid(),f.enrollment,f.student,f.instructor,f.cohort,clock_timestamp()-interval '8 hours',clock_timestamp(),
      'otro','No podia asistir a esa practica','falta',false),
    (gen_random_uuid(),f.enrollment,f.student,f.instructor,f.cohort,clock_timestamp()-interval '10 hours',clock_timestamp(),
      'otro','No existia un horario para reponer','hora_perdida',false);
  insert into public.practice_slot_cancellations(slot_id,enrollment_id,student_id,instructor_id,cohort_id,
    slot_starts_at,cancelled_at,motivo_categoria,motivo_texto,resultado,consumio_reprogramacion,reprogramacion_numero) values
    (gen_random_uuid(),f.enrollment,f.student,f.instructor,f.cohort,clock_timestamp()-interval '12 hours',clock_timestamp(),
      'otro','Aviso con derecho a reposicion','reprogramable',true,1);
  result := public.student_practice_history(f.student,f.enrollment,1,100);
  if result->'summary' <> '{"horasAsistidas":1,"horasObjetivo":10,"horasPerdidas":4}'::jsonb
    or (result->>'total')::integer<>7
    or not exists(select 1 from jsonb_array_elements(result->'items') x where x->>'estado'='falta' and x->'attended'='null'::jsonb)
    or not exists(select 1 from jsonb_array_elements(result->'items') x where x->>'estado'='liberada') then
    raise exception 'Historial o horas incorrectos: %',result; end if;
  result := public.student_practice_history(f.student,f.enrollment,20,1);
  if result->'items'<>'[]'::jsonb or (result->'summary'->>'horasAsistidas')::numeric<>1 then
    raise exception 'Resumen depende de pagina'; end if;
  begin
    insert into public.enrollments(student_id,cohort_id,status,monto_total)
      values(f.student,f.cohort,'finalizado',100);
    perform public.student_practice_history(f.student,f.enrollment);
    raise exception 'Se atribuyeron horas de una cohorte a dos matriculas'; exception when sqlstate 'CD409' then null;
  end;
  update public.enrollments set horas_practica_objetivo=null where id=f.other_enrollment;
  result := public.student_practice_history(f.other_student,f.other_enrollment);
  if result->'summary' <> '{"horasAsistidas":0,"horasObjetivo":null,"horasPerdidas":0}'::jsonb
    or result->'items'<>'[]'::jsonb then raise exception 'Se inventaron horas/objetivo o se filtro otro alumno'; end if;
  select count(*) into before_count from public.notifications where tipo='asistencia_corregida';
  perform public.correct_practice_attendance(f.recent_slot,f.instructor,true,'Segunda correccion de la misma practica');
  if (select count(*) from public.notifications where tipo='asistencia_corregida')<>before_count+1 then raise exception 'Se deduplicaron eventos distintos'; end if;
end $$;
reset role;
-- Provocar fallo de bandeja: comprobar rollback de UPDATE y evento juntos.
create function pg_temp.fail_e4_notification() returns trigger language plpgsql as $$
begin
  if new.tipo='asistencia_corregida' and new.user_id=(select student from asistencia_e4_fixture) then
    raise exception 'Fallo simulado de bandeja' using errcode='ZZ001'; end if;
  return new;
end $$;
create trigger fixture_e4_notification_failure before insert on public.notifications
  for each row execute function pg_temp.fail_e4_notification();
set local role service_role;
do $$
declare f asistencia_e4_fixture; n bigint;
begin
  select * into f from asistencia_e4_fixture;
  select count(*) into n from public.practice_attendance_events where slot_id=f.recent_slot;
  begin perform public.correct_practice_attendance(f.recent_slot,f.instructor,false,'No debe persistir esta correccion');
    raise exception 'No fallo el aviso'; exception when sqlstate 'ZZ001' then null; end;
  if not (select attended from public.practice_slots where id=f.recent_slot)
    or (select count(*) from public.practice_attendance_events where slot_id=f.recent_slot)<>n then
    raise exception 'Cambio o evento persistio sin aviso'; end if;
end $$;
reset role;
rollback;
