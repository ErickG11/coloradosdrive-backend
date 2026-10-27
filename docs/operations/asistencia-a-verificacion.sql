-- Ejecutar ENTERO manualmente en SQL Editor DESPUÉS de aplicar 030.
-- Solo crea fixtures nuevos dentro de esta transacción, sin correos ni Broadcast.
-- No toca filas de alumnos reales. ROLLBACK final obligatorio, incluso ante un error.
-- Requiere una sesión administrativa con permisos de insertar fixtures en auth.users.
-- Concurrencia LÓGICA: dos cancelaciones con un solo cambio restante se prueban
-- en el orden serial impuesto por FOR UPDATE de la matrícula. Este script de una
-- conexión NO demuestra espera/bloqueos entre dos sesiones reales.
begin;
set local lock_timeout = '5s';
create temp table asistencia_e1_fixture (
  student uuid, other_student uuid, instructor uuid, admin_id uuid, cohort uuid,
  course uuid, enrollment uuid, instructor_b uuid, monday date
) on commit drop;
insert into asistencia_e1_fixture values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  date_trunc('week', clock_timestamp() at time zone 'America/Guayaquil')::date + 14
);
do $$
declare f asistencia_e1_fixture; v_user uuid; v_cedula text;
begin
  select * into f from asistencia_e1_fixture;
  foreach v_user in array array[f.student, f.other_student, f.instructor, f.instructor_b, f.admin_id] loop
    loop
      v_cedula := lpad(floor(random() * 10000000000)::bigint::text, 10, '0');
      exit when not exists(select 1 from public.users where cedula = v_cedula);
    end loop;
    insert into auth.users(id) values(v_user);
    insert into public.users(id, cedula, nombre_completo, rol)
      values(v_user, v_cedula, 'Fixture asistencia E1 ' || v_user::text,
        case when v_user in (f.instructor,f.instructor_b) then 'instructor'::public.user_role
          when v_user=f.admin_id then 'admin'::public.user_role else 'estudiante'::public.user_role end);
  end loop;
  insert into public.courses(id,nombre,tipo) values(f.course,'Fixture asistencia E1','A');
  insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,
    fecha_inicio_matricula,fecha_fin_matricula)
    values(f.cohort,f.course,'Fixture asistencia E1 ' || f.cohort::text,100,10,f.monday,f.monday+30,
      f.monday-30,f.monday-1);
  insert into public.enrollments(id,student_id,cohort_id,status,monto_total,practice_plan)
    values(f.enrollment,f.student,f.cohort,'activo',100,
      jsonb_build_object('fechaFinElegida',f.monday+11,'modalidad','entre_semana'));
end $$;
grant select on asistencia_e1_fixture to service_role;
set local role service_role;
do $$
declare f asistencia_e1_fixture; s public.practice_slots; v_slots uuid[] := array[]::uuid[];
  v_id uuid; v_other_cohort uuid := gen_random_uuid(); v_response jsonb; v_preview jsonb; v_count integer; v_num integer;
  v_start timestamptz; v_boundary timestamptz; v_version text;
begin
  select * into f from asistencia_e1_fixture;
  -- Cuatro prácticas en días distintos. Al principio no hay ninguna alternativa.
  for v_num in 0..3 loop
    v_start := (f.monday + v_num + time '09:00') at time zone 'America/Guayaquil';
    insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
      values(f.cohort,f.instructor,f.student,v_start,'asignado') returning id into v_id;
    v_slots := array_append(v_slots,v_id);
  end loop;
  -- Candidatas que deben excluirse: otra cohorte, fin de semana, después
  -- del límite, pasada, cerrada a T-5 o cruzada con otra práctica del alumno.
  insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,
    fecha_inicio_matricula,fecha_fin_matricula)
    values(v_other_cohort,f.course,'Fixture otra cohorte '||v_other_cohort::text,100,10,
      f.monday,f.monday+30,f.monday-30,f.monday-1);
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at) values
    (v_other_cohort,f.instructor,(f.monday+time '12:00') at time zone 'America/Guayaquil'),
    (f.cohort,f.instructor,(f.monday+5+time '09:00') at time zone 'America/Guayaquil'),
    (f.cohort,f.instructor,(f.monday+14+time '09:00') at time zone 'America/Guayaquil'),
    (f.cohort,f.instructor_b,clock_timestamp()-interval '6 hours'),
    (f.cohort,f.instructor_b,clock_timestamp()+interval '3 minutes'),
    (f.cohort,f.instructor_b,(f.monday+3+time '09:00') at time zone 'America/Guayaquil');
  if exists(select 1 from private.eligible_free_slots_for_enrollment(f.enrollment,v_slots[1])) then
    raise exception 'Se aceptó una alternativa no elegible'; end if;
  update public.enrollments set practice_plan=jsonb_set(practice_plan,'{modalidad}','"fin_de_semana"') where id=f.enrollment;
  select count(*) into v_count from private.eligible_free_slots_for_enrollment(f.enrollment,v_slots[1]);
  if v_count<>1 then raise exception 'Filtro fin de semana incorrecto: %',v_count; end if;
  update public.enrollments set practice_plan=jsonb_set(practice_plan,'{modalidad}','"entre_semana"') where id=f.enrollment;
  begin
    update public.enrollments set practice_plan=null where id=f.enrollment;
    perform public.cancel_practice_slot_with_reason(v_slots[1],f.student,'otro','Motivo suficientemente largo');
    raise exception 'Se canceló inventando un plan ausente';
  exception when sqlstate 'CD409' then null; end;
  begin
    update public.enrollments set practice_plan=jsonb_set(practice_plan,'{fechaFinElegida}','"2026-02-30"') where id=f.enrollment;
    perform public.preview_practice_slot_cancellation(v_slots[1],f.student);
    raise exception 'Se aceptó una fecha imposible';
  exception when sqlstate 'CD409' then null; end;
  begin
    update public.users set activo=false where id=f.student;
    perform public.cancel_practice_slot_with_reason(v_slots[1],f.student,'otro','Motivo suficientemente largo');
    raise exception 'Se aceptó cancelar con cuenta inactiva';
  exception when sqlstate 'CD403' then null; end;
  v_preview := public.preview_practice_slot_cancellation(v_slots[1],f.student);
  if v_preview <> jsonb_build_object('reprogramacionesRestantes',2,'hayFranjasLibres',false,'resultadoSiCancela','hora_perdida') then
    raise exception 'Vista previa sin alternativas incorrecta: %',v_preview; end if;
  if exists(select 1 from public.practice_slot_cancellations where student_id=f.student) then
    raise exception 'La vista previa escribió historial'; end if;
  -- Motivo corto y actor ajeno no pueden cancelar ni consumir contador.
  begin
    perform public.cancel_practice_slot_with_reason(v_slots[1],f.student,'otro',' corto ');
    raise exception 'Se aceptó motivo corto';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.preview_practice_slot_cancellation(v_slots[1],f.other_student);
    raise exception 'Se mostró una práctica ajena';
  exception when sqlstate 'CD404' then null; end;
  begin
    perform public.cancel_practice_slot_with_reason(v_slots[1],f.other_student,'otro','Motivo suficientemente largo');
    raise exception 'Se canceló una práctica ajena';
  exception when sqlstate 'CD404' then null; end;

  v_response := public.cancel_practice_slot_with_reason(v_slots[1],f.student,'salud','  Tengo una consulta médica  ');
  if v_response->>'resultado'<>'hora_perdida' or (v_response->>'consumioReprogramacion')::boolean
    or (v_response->>'reprogramacionesRestantes')::integer<>2 then
    raise exception 'Hora perdida incorrecta: %',v_response; end if;
  -- La primera franja quedó libre: ahora sí es una alternativa para las demás.
  v_response := public.cancel_practice_slot_with_reason(v_slots[2],f.student,'trabajo','Tengo un turno de trabajo');
  if v_response->>'resultado'<>'reprogramable' or (v_response->>'reprogramacionNumero')::integer<>1 then
    raise exception 'Primer cambio incorrecto: %',v_response; end if;
  -- Dos solicitudes con un solo cambio restante: la segunda debe observar el 2.
  v_response := public.cancel_practice_slot_with_reason(v_slots[3],f.student,'estudios','Tengo una evaluación escolar');
  if v_response->>'resultado'<>'reprogramable' or (v_response->>'reprogramacionNumero')::integer<>2 then
    raise exception 'Segundo cambio incorrecto: %',v_response; end if;
  v_response := public.cancel_practice_slot_with_reason(v_slots[4],f.student,'familiar','Tengo una emergencia familiar');
  if v_response->>'resultado'<>'falta' or (v_response->>'consumioReprogramacion')::boolean
    or v_response->>'reprogramacionNumero' is not null then
    raise exception 'Tope de dos incorrecto: %',v_response; end if;
  if (select reprogramaciones_usadas from public.enrollments where id=f.enrollment)<>2 then
    raise exception 'Se superó o no se conservó el tope de dos'; end if;
  select count(*) into v_count from public.practice_slot_cancellations where enrollment_id=f.enrollment and consumio_reprogramacion;
  if v_count<>2 then raise exception 'El historial no coincide con el contador'; end if;
  begin
    perform public.cancel_practice_slot_with_reason(v_slots[4],f.student,'otro','Reintento de la misma práctica');
    raise exception 'Se duplicó una cancelación';
  exception when sqlstate 'CD404' then null; end;
  begin
    update public.enrollments set reprogramaciones_usadas=3 where id=f.enrollment;
    raise exception 'El CHECK permitió un tercer cambio';
  exception when check_violation then null; end;
  begin
    perform public.act_on_practice_slot(v_slots[1],f.student,'cancel');
    raise exception 'Se aceptó cancelar sin motivo por la RPC antigua';
  exception when sqlstate '22023' then null; end;
  begin
    perform private.book_practice_slot(v_slots[1],f.student,'cancel');
    raise exception 'Se aceptó cancelar sin motivo por el helper antiguo';
  exception when sqlstate '22023' then null; end;

  -- Límite de difusión exacto, sin depender de cuánto tarda el script.
  v_boundary := clock_timestamp();
  if public.practice_slot_window_open(v_boundary+interval '5 minutes',v_boundary) then
    raise exception 'T-5 debe cerrar la difusión'; end if;
  if not public.practice_slot_window_open(v_boundary+interval '5 minutes 1 second',v_boundary) then
    raise exception 'Más de cinco minutos debe permitir difusión'; end if;
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructor,f.student,clock_timestamp()+interval '4 minutes','confirmado') returning id into v_id;
  v_response := public.cancel_practice_slot_with_reason(v_id,f.student,'transporte','No tengo transporte disponible');
  if v_response->'slot'->>'status'<>'sin_practica' or (v_response->>'difundirCohorte')::boolean then
    raise exception 'Cancelación tardía incorrecta: %',v_response; end if;
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructor,f.student,clock_timestamp()-interval '2 hours','asignado') returning * into s;
  begin
    perform public.cancel_practice_slot_with_reason(s.id,f.student,'otro','La práctica ya había empezado');
    raise exception 'Se aceptó cancelar una práctica iniciada';
  exception when sqlstate 'CD409' then null; end;
  -- Silencio: no cierra asignado a T-5; sí termina tras 60 min, sin registrar asistencia.
  if public.practice_slot_transition_due(s,'close',s.scheduled_at-interval '5 minutes') then
    raise exception 'Asignado se sigue cerrando a T-5'; end if;
  if not public.practice_slot_transition_due(s,'complete',s.scheduled_at+interval '60 minutes') then
    raise exception 'Asignado sin confirmar no puede terminar'; end if;
  select xmin::text into v_version from public.practice_slots where id=s.id;
  perform public.transition_practice_slot_for_scheduler(s.id,'complete',v_version);
  select * into s from public.practice_slots where id=s.id;
  if s.status<>'completado' or s.attended is not null then
    raise exception 'Completar alteró la asistencia real'; end if;
  select * into s from public.practice_slots where id=v_slots[1];
  if not public.practice_slot_transition_due(s,'close',s.scheduled_at-interval '5 minutes') then
    raise exception 'Un cupo liberado vacío no cierra a T-5'; end if;
  s.status:='disponible';
  if public.practice_slot_transition_due(s,'close',s.scheduled_at-interval '5 minutes') then
    raise exception 'Una franja disponible se cierra a T-5'; end if;
  -- Las acciones vigentes de reservar/confirmar siguen funcionando y no
  -- vuelven a consumir el cambio ya contabilizado al cancelar (reserva E2 pendiente).
  perform public.act_on_practice_slot(v_slots[1],f.student,'claim');
  perform public.act_on_practice_slot(v_slots[1],f.student,'confirm');
  if (select status from public.practice_slots where id=v_slots[1])<>'confirmado'
    or (select reprogramaciones_usadas from public.enrollments where id=f.enrollment)<>2 then
    raise exception 'La reserva/confirmación alteró el contador o no conservó su contrato'; end if;
  raise notice 'E1: tres resultados, tope dos, serialización lógica, límites y silencio: OK';
end $$;
reset role;
rollback;
