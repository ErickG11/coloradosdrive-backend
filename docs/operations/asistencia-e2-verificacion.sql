-- Ejecutar ENTERO después de 031. Fixtures nuevos; sin correo/Broadcast.
-- Una sola conexión, ROLLBACK final obligatorio. No toca alumnos reales.
-- Las dos solicitudes al mismo cupo se ensayan en el orden SERIAL impuesto
-- por FOR UPDATE. NO demuestra espera ni bloqueos reales entre conexiones.
-- La prueba HTTP paralela tampoco lo demuestra: usa RPCs mockeadas.
begin;
set local lock_timeout = '5s';
create temp table asistencia_e2_fixture (
  students uuid[], instructors uuid[], enrollments uuid[], course uuid, cohort uuid, monday date
) on commit drop;
insert into asistencia_e2_fixture values (
  array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()],
  array[gen_random_uuid(),gen_random_uuid()],
  array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()],
  gen_random_uuid(),gen_random_uuid(),
  date_trunc('week',clock_timestamp() at time zone 'America/Guayaquil')::date + 14
);
do $$
declare f asistencia_e2_fixture; v_id uuid; v_cedula text; i integer;
begin
  select * into f from asistencia_e2_fixture;
  foreach v_id in array f.students || f.instructors loop
    loop
      v_cedula := lpad(floor(random()*10000000000)::bigint::text,10,'0');
      exit when not exists(select 1 from public.users where cedula=v_cedula);
    end loop;
    insert into auth.users(id) values(v_id);
    insert into public.users(id,cedula,nombre_completo,rol) values(v_id,v_cedula,'Fixture E2 '||v_id::text,
      case when v_id=any(f.instructors) then 'instructor'::public.user_role else 'estudiante'::public.user_role end);
  end loop;
  insert into public.courses(id,nombre,tipo) values(f.course,'Fixture asistencia E2','A');
  insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,
    fecha_inicio_matricula,fecha_fin_matricula) values(f.cohort,f.course,'Fixture E2 '||f.cohort::text,
      100,10,f.monday,f.monday+30,f.monday-30,f.monday-1);
  for i in 1..5 loop
    insert into public.enrollments(id,student_id,cohort_id,status,monto_total,practice_plan)
      values(f.enrollments[i],f.students[i],f.cohort,'activo',100,
        jsonb_build_object('fechaFinElegida',f.monday+11,'modalidad','entre_semana','horas',2,'horasPorDia',1));
  end loop;
end $$;
grant select on asistencia_e2_fixture to service_role;
set local role service_role;
do $$
declare f asistencia_e2_fixture; sources uuid[] := '{}'; targets uuid[] := '{}'; v_id uuid;
  v_response jsonb; v_cancel jsonb; v_counter integer; v_num integer; v_other_source uuid;
  v_race_sources uuid[] := '{}'; v_race_target uuid; v_daily_target uuid; v_late uuid;
begin
  select * into f from asistencia_e2_fixture;
  -- Alumno 1: dos horas programadas; cualquier movimiento es B.
  for v_num in 0..1 loop
    insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
      values(f.cohort,f.instructors[1],f.students[1],
        (f.monday+v_num+time '09:00') at time zone 'America/Guayaquil','asignado') returning id into v_id;
    sources := array_append(sources,v_id);
  end loop;
  for v_num in 2..4 loop
    insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,status)
      values(f.cohort,f.instructors[1],(f.monday+v_num+time '09:00') at time zone 'America/Guayaquil','liberado') returning id into v_id;
    targets := array_append(targets,v_id);
  end loop;
  if jsonb_array_length(public.pending_practice_slots_for_student(f.students[1]))<>2 then raise exception 'Selector B incorrecto'; end if;
  if not exists(select 1 from private.eligible_practice_slot_changes(f.enrollments[1]) c where (c.slot).id=targets[1] and c.caso='B') then
    raise exception 'B elegible no listado'; end if;
  -- B exige origen; antigua RPC claim tampoco lo permite omitir.
  begin perform public.act_on_practice_slot(targets[1],f.students[1],'claim');
    raise exception 'Claim omitió la práctica a soltar'; exception when sqlstate '22023' then null; end;
  v_response := public.swap_practice_slot(targets[1],f.students[1],sources[1]);
  if v_response->>'caso'<>'B' or (v_response->>'reprogramacionesRestantes')::integer<>1 then raise exception 'B no consumió uno'; end if;
  if not exists(select 1 from public.practice_slots where id=sources[1] and student_id is null and status='liberado') then
    raise exception 'Origen no fue liberado'; end if;
  if not exists(select 1 from public.practice_slot_cancellations where id=(v_response->>'cancellationId')::uuid
    and origen='cambio_cupo' and repuesto_por_slot_id=targets[1] and repuesto_en is not null and consumio_reprogramacion) then
    raise exception 'Falta auditoría B'; end if;
  perform public.swap_practice_slot(targets[2],f.students[1],sources[2]);
  begin perform public.swap_practice_slot(targets[3],f.students[1],targets[1]);
    raise exception 'B permitió una tercera reprogramación'; exception when sqlstate 'CD409' then null; end;

  -- Alumno 2: E1 cancela una de sus dos horas y E2 la repone sin segundo consumo.
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[2],f.students[2],(f.monday+time '11:00') at time zone 'America/Guayaquil','confirmado') returning id into v_id;
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[2],f.students[2],(f.monday+1+time '11:00') at time zone 'America/Guayaquil','asignado') returning id into v_other_source;
  v_cancel := public.cancel_practice_slot_with_reason(v_id,f.students[2],'salud','Tengo una consulta médica');
  if v_cancel->>'resultado'<>'reprogramable' then raise exception 'E1 no generó reposición'; end if;
  begin perform public.swap_practice_slot(targets[3],f.students[2],v_other_source);
    raise exception 'A aceptó práctica a soltar'; exception when sqlstate '22023' then null; end;
  v_response := public.swap_practice_slot(targets[3],f.students[2],null);
  if v_response->>'caso'<>'A' or (v_response->>'reprogramacionesRestantes')::integer<>1 then raise exception 'A consumió otra reprogramación'; end if;
  if not exists(select 1 from public.practice_slot_cancellations where id=(v_cancel->>'cancellationId')::uuid
    and repuesto_por_slot_id=targets[3] and repuesto_en is not null and origen='alumno') then raise exception 'A sin enlace al historial'; end if;
  select reposiciones_pendientes into v_counter from private.practice_replacement_balance(f.enrollments[2]);
  if v_counter<>0 then raise exception 'A dejó una reposición duplicable'; end if;
  -- Una segunda cancelación E1 agota el contador, pero su reposición A sigue permitida.
  v_cancel := public.cancel_practice_slot_with_reason(v_other_source,f.students[2],'otro','Necesito reponer esta práctica');
  v_response := public.swap_practice_slot(v_other_source,f.students[2],null);
  if v_response->>'caso'<>'A' or (v_response->>'reprogramacionesRestantes')::integer<>0 then raise exception 'A rechazó o consumió con dos usadas'; end if;

  -- Dos alumnos compiten por el mismo cupo: resultado equivalente a dos
  -- transacciones SERIALIZADAS. NO son conexiones simultáneas en este script.
  for v_num in 3..4 loop
    insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
      values(f.cohort,f.instructors[1],f.students[v_num],
        (f.monday+time '13:00'+(v_num-3)*interval '1 hour') at time zone 'America/Guayaquil','asignado') returning id into v_id;
    v_race_sources := array_append(v_race_sources,v_id);
  end loop;
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at)
    values(f.cohort,f.instructors[1],(f.monday+4+time '15:00') at time zone 'America/Guayaquil') returning id into v_race_target;
  perform public.swap_practice_slot(v_race_target,f.students[3],v_race_sources[1]);
  begin perform public.swap_practice_slot(v_race_target,f.students[4],v_race_sources[2]);
    raise exception 'Segundo alumno también tomó el mismo cupo'; exception when sqlstate 'CD409' then null; end;
  if not exists(select 1 from public.practice_slots where id=v_race_sources[2] and student_id=f.students[4] and status='asignado')
    or (select reprogramaciones_usadas from public.enrollments where id=f.enrollments[4])<>0 then raise exception 'El perdedor perdió su práctica/contador'; end if;

  -- Cruce con OTRA práctica propia que no se está soltando.
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[2],f.students[4],(f.monday+2+time '15:00') at time zone 'America/Guayaquil','asignado');
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at)
    values(f.cohort,f.instructors[1],(f.monday+2+time '15:00') at time zone 'America/Guayaquil') returning id into v_id;
  if exists(select 1 from private.eligible_practice_slot_changes(f.enrollments[4]) c
    where (c.slot).id=v_id and v_race_sources[2]=any(c.source_slot_ids)) then raise exception 'Se ofreció un cupo cruzado'; end if;
  begin perform public.swap_practice_slot(v_id,f.students[4],v_race_sources[2]);
    raise exception 'Se tomó un cupo cruzado'; exception when sqlstate 'CD409' then null; end;

  -- Cambiar dentro del mismo día puede liberar el bloque propio que se cruza.
  -- La GiST debe conservarse: liberar origen antes de ocupar destino.
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at)
    values(f.cohort,f.instructors[2],(f.monday+time '14:30') at time zone 'America/Guayaquil') returning id into v_id;
  perform public.swap_practice_slot(v_id,f.students[4],v_race_sources[2]);
  v_race_sources[2] := v_id;

  -- El cupo diario ya completado se cuenta aunque no se haya marcado attended.
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[2],f.students[5],(f.monday+time '16:00') at time zone 'America/Guayaquil','completado');
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[2],f.students[5],(f.monday+1+time '16:00') at time zone 'America/Guayaquil','asignado') returning id into v_other_source;
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at)
    values(f.cohort,f.instructors[1],(f.monday+time '18:00') at time zone 'America/Guayaquil') returning id into v_daily_target;
  if exists(select 1 from private.eligible_practice_slot_changes(f.enrollments[5]) c where (c.slot).id=v_daily_target) then raise exception 'Se excedió el cupo diario completado'; end if;
  begin perform public.swap_practice_slot(v_daily_target,f.students[5],v_other_source);
    raise exception 'RPC excedió el cupo diario'; exception when sqlstate 'CD409' then null; end;
  update public.enrollments set reprogramaciones_usadas=2 where id=f.enrollments[5];
  v_cancel := public.cancel_practice_slot_with_reason(v_other_source,f.students[5],'otro','Cancelación sin derecho a reposición');
  select reposiciones_pendientes into v_counter from private.practice_replacement_balance(f.enrollments[5]);
  if v_cancel->>'resultado'<>'falta' or v_counter<>0 then raise exception 'Una falta creó derecho a reposición A'; end if;

  -- T-5: usar hora local válida para que el rechazo dependa del margen.
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at)
    values(f.cohort,f.instructors[1],clock_timestamp()+interval '4 minutes') returning id into v_late;
  if exists(select 1 from private.eligible_practice_slot_changes(f.enrollments[4]) c where (c.slot).id=v_late) then raise exception 'Se ofreció cupo a T-4'; end if;
  begin perform public.swap_practice_slot(v_late,f.students[4],v_race_sources[2]);
    raise exception 'Se tomó un cupo a T-4'; exception when sqlstate 'CD409' then null; end;
  -- La cancelación tardía E1 conserva su decisión de NO difundir al grupo.
  update public.practice_slots set student_id=f.students[4],status='asignado' where id=v_late;
  v_cancel := public.cancel_practice_slot_with_reason(v_late,f.students[4],'otro','Cancelación tardía de prueba');
  if (v_cancel->>'difundirCohorte')::boolean or v_cancel->'slot'->>'status'<>'sin_practica' then raise exception 'E1 difundió cancelación tardía'; end if;

  -- Fuente canónica y ausencia de defaults inventados.
  update public.enrollments set horas_practica_objetivo=3 where id=f.enrollments[4];
  select horas_objetivo into v_counter from private.practice_replacement_balance(f.enrollments[4]);
  if v_counter<>3 then raise exception 'No se priorizó objetivo de matrícula'; end if;
  begin
    update public.enrollments set practice_plan=practice_plan-'horasPorDia' where id=f.enrollments[4];
    perform public.released_practice_slots_for_student(f.students[4]);
    raise exception 'Se inventaron horasPorDia'; exception when sqlstate 'CD409' then null;
  end;
end $$;
reset role;
rollback;
