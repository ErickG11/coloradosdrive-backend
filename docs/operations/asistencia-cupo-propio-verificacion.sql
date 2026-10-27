-- Ejecutar ENTERO tras 032, en una sola conexion. ROLLBACK final obligatorio.
-- Las dos solicitudes al ultimo cupo son seriales: prueban el segundo rechazo,
-- no la espera real entre dos conexiones simultaneas.
begin;
set local lock_timeout = '5s';
create temp table asistencia_cupo_propio_fixture (
  students uuid[], instructors uuid[], enrollments uuid[], course uuid, cohort uuid, monday date
) on commit drop;
insert into asistencia_cupo_propio_fixture values (
  array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()],
  array[gen_random_uuid(), gen_random_uuid()],
  array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()],
  gen_random_uuid(), gen_random_uuid(),
  date_trunc('week', clock_timestamp() at time zone 'America/Guayaquil')::date + 14
);
do $$
declare f asistencia_cupo_propio_fixture; v_id uuid; v_cedula text; i integer;
begin
  select * into f from asistencia_cupo_propio_fixture;
  foreach v_id in array f.students || f.instructors loop
    loop
      v_cedula := lpad(floor(random()*10000000000)::bigint::text, 10, '0');
      exit when not exists(select 1 from public.users where cedula = v_cedula);
    end loop;
    insert into auth.users(id) values(v_id);
    insert into public.users(id, cedula, nombre_completo, rol)
      values(v_id, v_cedula, 'Fixture cupo propio ' || v_id::text,
        case when v_id = any(f.instructors) then 'instructor'::public.user_role
          else 'estudiante'::public.user_role end);
  end loop;
  insert into public.courses(id, nombre, tipo) values(f.course, 'Fixture cupo propio', 'A');
  insert into public.cohorts(id, course_id, nombre, precio, cupo_maximo,
    fecha_inicio_curso, fecha_fin_curso, fecha_inicio_matricula, fecha_fin_matricula)
    values(f.cohort, f.course, 'Fixture cupo propio ' || f.cohort::text, 100, 10,
      f.monday, f.monday+30, f.monday-30, f.monday-1);
  for i in 1..3 loop
    insert into public.enrollments(id, student_id, cohort_id, status, monto_total, practice_plan)
      values(f.enrollments[i], f.students[i], f.cohort, 'activo', 100,
        jsonb_build_object('fechaFinElegida', f.monday+11, 'modalidad', 'entre_semana',
          'horas', case when i=1 then 2 else 1 end, 'horasPorDia', 1));
  end loop;
end $$;
grant select on asistencia_cupo_propio_fixture to service_role;
set local role service_role;
do $$
declare f asistencia_cupo_propio_fixture; own_target uuid; own_next uuid;
  other_source uuid; third_source uuid; shared_target uuid;
  v_result jsonb; v_list jsonb; v_balance record; v_message text;
begin
  select * into f from asistencia_cupo_propio_fixture;
  -- El alumno 1 tiene dos practicas. No existe otro cupo libre al cancelar.
  insert into public.practice_slots(cohort_id, instructor_id, student_id, scheduled_at, status)
    values(f.cohort, f.instructors[1], f.students[1],
      (f.monday+time '09:00') at time zone 'America/Guayaquil', 'asignado')
    returning id into own_target;
  insert into public.practice_slots(cohort_id, instructor_id, student_id, scheduled_at, status)
    values(f.cohort, f.instructors[1], f.students[1],
      (f.monday+1+time '11:00') at time zone 'America/Guayaquil', 'asignado')
    returning id into own_next;
  insert into public.practice_slots(cohort_id, instructor_id, student_id, scheduled_at, status)
    values(f.cohort, f.instructors[2], f.students[2],
      (f.monday+1+time '09:00') at time zone 'America/Guayaquil', 'asignado')
    returning id into other_source;
  insert into public.practice_slots(cohort_id, instructor_id, student_id, scheduled_at, status)
    values(f.cohort, f.instructors[2], f.students[3],
      (f.monday+2+time '09:00') at time zone 'America/Guayaquil', 'asignado')
    returning id into third_source;

  v_result := public.cancel_practice_slot_with_reason(own_target, f.students[1], 'otro',
    'No podre asistir a esta practica');
  if v_result->>'resultado' <> 'hora_perdida' or (v_result->>'consumioReprogramacion')::boolean
    or not exists(select 1 from public.practice_slots where id=own_target and status='liberado' and student_id is null)
    then raise exception 'La cancelacion de prueba no produjo hora_perdida sin consumo'; end if;
  select * into v_balance from private.practice_replacement_balance(f.enrollments[1]);
  if v_balance.reposiciones_pendientes <> 0
    or (select reprogramaciones_usadas from public.enrollments where id=f.enrollments[1]) <> 0
    then raise exception 'hora_perdida creo derecho A o consumio reprogramacion'; end if;
  -- Una segunda vista previa no puede contar el cupo soltado previamente.
  v_result := public.preview_practice_slot_cancellation(own_next, f.students[1]);
  if v_result->>'resultadoSiCancela' <> 'hora_perdida' or (v_result->>'hayFranjasLibres')::boolean
    then raise exception 'E1 conto el propio cupo anterior como alternativa'; end if;

  v_list := public.released_practice_slots_for_student(f.students[1]);
  if exists(select 1 from jsonb_array_elements(v_list) item where item->>'id'=own_target::text)
    then raise exception 'El alumno que solto el cupo lo ve en released-for-me'; end if;
  v_list := public.released_practice_slots_for_student(f.students[2]);
  if not exists(select 1 from jsonb_array_elements(v_list) item
    where item->>'id'=own_target::text and item->>'caso'='B')
    then raise exception 'Otro alumno elegible de la cohorte no ve el cupo'; end if;

  begin
    perform public.swap_practice_slot(own_target, f.students[1], own_next);
    raise exception 'swap acepto la franja propia';
  exception when sqlstate 'CD409' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'No puedes volver a tomar una práctica que tú mismo soltaste'
      then raise exception 'swap devolvio otro conflicto: %', v_message; end if;
  end;
  begin
    perform public.act_on_practice_slot(own_target, f.students[1], 'claim');
    raise exception 'claim acepto la franja propia';
  exception when sqlstate 'CD409' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'No puedes volver a tomar una práctica que tú mismo soltaste'
      then raise exception 'claim devolvio otro conflicto: %', v_message; end if;
  end;

  -- Otro alumno la toma mediante B y libera su origen en silencio.
  v_result := public.swap_practice_slot(own_target, f.students[2], other_source);
  if v_result->>'caso' <> 'B' or v_result->>'practicaSoltadaId' <> other_source::text
    or not exists(select 1 from public.practice_slots where id=own_target and student_id=f.students[2])
    then raise exception 'El cambio legitimo entre alumnos fallo'; end if;
  v_list := public.released_practice_slots_for_student(f.students[2]);
  if exists(select 1 from jsonb_array_elements(v_list) item where item->>'id'=other_source::text)
    then raise exception 'El origen B se ofrecio de nuevo a quien lo solto'; end if;
  begin
    perform public.swap_practice_slot(other_source, f.students[2], own_target);
    raise exception 'swap acepto un origen cambio_cupo del mismo alumno';
  exception when sqlstate 'CD409' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'No puedes volver a tomar una práctica que tú mismo soltaste'
      then raise exception 'El origen cambio_cupo devolvio otro conflicto: %', v_message; end if;
  end;

  -- Segundo cupo: ganador y perdedor seriales conservan la regla de carrera E2.
  insert into public.practice_slots(cohort_id, instructor_id, scheduled_at)
    values(f.cohort, f.instructors[1],
      (f.monday+3+time '15:00') at time zone 'America/Guayaquil')
    returning id into shared_target;
  perform public.swap_practice_slot(shared_target, f.students[2], own_target);
  begin
    perform public.swap_practice_slot(shared_target, f.students[3], third_source);
    raise exception 'Dos alumnos tomaron el mismo cupo';
  exception when sqlstate 'CD409' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'Otro alumno tomó este cupo o ya no está disponible'
      then raise exception 'La carrera devolvio otro conflicto: %', v_message; end if;
  end;
  if not exists(select 1 from public.practice_slots where id=third_source and student_id=f.students[3] and status='asignado')
    or (select reprogramaciones_usadas from public.enrollments where id=f.enrollments[3]) <> 0
    then raise exception 'El perdedor perdio su origen o contador'; end if;
end $$;
reset role;
rollback;
