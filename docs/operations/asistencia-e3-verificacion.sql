-- Ejecutar ENTERO despues de 033. Fixtures nuevos, sin SMTP ni Broadcast.
-- Una conexion; no demuestra bloqueos reales entre procesos concurrentes.
begin;
set local lock_timeout = '5s';
create temp table asistencia_e3_fixture (
  students uuid[], instructors uuid[], enrollments uuid[], course uuid, cohort uuid, monday date
) on commit drop;
insert into asistencia_e3_fixture values (
  array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()],
  array[gen_random_uuid(),gen_random_uuid()],
  array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()],
  gen_random_uuid(),gen_random_uuid(),
  date_trunc('week',clock_timestamp() at time zone 'America/Guayaquil')::date+14);
do $$
declare f asistencia_e3_fixture; u uuid; ced text; i integer;
begin
  select * into f from asistencia_e3_fixture;
  foreach u in array f.students || f.instructors loop
    loop
      ced := lpad(floor(random()*10000000000)::bigint::text,10,'0');
      exit when not exists(select 1 from public.users where cedula=ced);
    end loop;
    insert into auth.users(id) values(u);
    insert into public.users(id,cedula,nombre_completo,rol) values(u,ced,'Fixture E3 '||u::text,
      case when u=any(f.instructors) then 'instructor'::public.user_role else 'estudiante'::public.user_role end);
  end loop;
  insert into public.courses(id,nombre,tipo) values(f.course,'Fixture E3','A');
  insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,
    fecha_inicio_matricula,fecha_fin_matricula) values(f.cohort,f.course,'Fixture E3 '||f.cohort::text,
      100,10,f.monday,f.monday+30,f.monday-30,f.monday-1);
  for i in 1..3 loop
    insert into public.enrollments(id,student_id,cohort_id,status,monto_total,practice_plan)
    values(f.enrollments[i],f.students[i],f.cohort,'activo',100,
      jsonb_build_object('fechaFinElegida',f.monday+11,'modalidad','entre_semana','horas',2,'horasPorDia',1));
  end loop;
end $$;
grant select on asistencia_e3_fixture to service_role;
set local role service_role;
do $$
declare f asistencia_e3_fixture; s1 public.practice_slots; s2 public.practice_slots; sample public.practice_slots;
  version text; n1 public.notifications; n2 public.notifications; claimed public.notifications;
  value jsonb; stamp timestamptz; v_count integer; origin uuid; other_origin uuid; target uuid; closed uuid; extra uuid;
begin
  select * into f from asistencia_e3_fixture;
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[1],f.students[1],clock_timestamp()+interval '19 minutes','asignado') returning * into s1;
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[2],f.students[2],clock_timestamp()+interval '19 minutes','confirmado') returning * into s2;
  sample := s1;
  sample.scheduled_at := clock_timestamp()+interval '4 minutes';
  if public.practice_slot_transition_due(sample,'close',clock_timestamp())
    or not public.practice_slot_transition_due(sample,'remind',clock_timestamp())
    then raise exception 'Asignado sin confirmar se cerro o perdio recordatorio a T-4'; end if;
  sample.status := 'confirmado';
  if public.practice_slot_transition_due(sample,'close',clock_timestamp())
    or not public.practice_slot_transition_due(sample,'remind',clock_timestamp())
    then raise exception 'Confirmado perdio recordatorio o se cerro'; end if;
  sample.scheduled_at := clock_timestamp()+interval '21 minutes';
  if public.practice_slot_transition_due(sample,'remind',clock_timestamp()) then raise exception 'Recordatorio antes de T-20'; end if;
  sample.scheduled_at := clock_timestamp()-interval '1 second';
  if public.practice_slot_transition_due(sample,'remind',clock_timestamp()) then raise exception 'Recordatorio despues de comenzar'; end if;

  select xmin::text into version from public.practice_slots where id=s1.id;
  perform public.transition_practice_slot_for_scheduler(s1.id,'remind',version);
  perform public.transition_practice_slot_for_scheduler(s1.id,'remind',version);
  update public.practice_slots set confirmation_notified_at=null where id=s1.id;
  select xmin::text into version from public.practice_slots where id=s1.id;
  perform public.transition_practice_slot_for_scheduler(s1.id,'remind',version);
  if (select count(*) from public.notifications where user_id=f.students[1] and tipo='recordatorio_practica')<>1
    then raise exception 'Recordatorio duplicado'; end if;
  select xmin::text into version from public.practice_slots where id=s2.id;
  perform public.transition_practice_slot_for_scheduler(s2.id,'remind',version);
  select * into n1 from public.notifications where user_id=f.students[1] and tipo='recordatorio_practica';
  select * into n2 from public.notifications where user_id=f.students[2] and tipo='recordatorio_practica';
  if n2.id is null then raise exception 'No se recordo la practica confirmada'; end if;

  value := public.list_user_notifications(f.students[1],1,1);
  if (value->>'total')::integer<>1 or (value->>'unreadCount')::integer<>1
    or value->'items'->0->>'id'<>n1.id::text then raise exception 'Listado o conteo del propietario incorrecto'; end if;
  if exists(select 1 from public.mark_user_notification_read(f.students[1],n2.id)) then raise exception 'Se leyo un aviso ajeno'; end if;
  perform public.mark_user_notification_read(f.students[1],n1.id);
  select read_at into stamp from public.notifications where id=n1.id;
  perform public.mark_user_notification_read(f.students[1],n1.id);
  if (select read_at from public.notifications where id=n1.id) is distinct from stamp then raise exception 'Read no idempotente'; end if;
  if public.read_all_user_notifications(f.students[1])<>0 or
    (select read_at from public.notifications where id=n2.id) is not null then raise exception 'Read-all toco otro propietario'; end if;
  if public.read_all_user_notifications(f.students[2])<>1 then raise exception 'Read-all no marco lo propio'; end if;

  -- Aislar un correo; comprobar concesion, retraso y tres intentos como maximo.
  update public.notifications set email_status=null where id=n2.id;
  select * into claimed from public.claim_notification_email();
  if claimed.id<>n1.id or claimed.email_attempts<>1 then raise exception 'Primer intento incorrecto'; end if;
  if exists(select 1 from public.claim_notification_email()) then raise exception 'Se reservo dos veces el mismo correo'; end if;
  if public.finish_notification_email(n1.id,gen_random_uuid(),null) then raise exception 'Un token ajeno termino el correo'; end if;
  perform public.finish_notification_email(n1.id,claimed.email_lease_token,'SMTP de prueba');
  if exists(select 1 from public.claim_notification_email()) then raise exception 'No se respeto el minuto entre intentos'; end if;
  for v_count in 2..3 loop
    update public.notifications set email_next_attempt_at=clock_timestamp()-interval '1 second' where id=n1.id;
    select * into claimed from public.claim_notification_email();
    if claimed.email_attempts<>v_count then raise exception 'Contador de intentos incorrecto'; end if;
    perform public.finish_notification_email(n1.id,claimed.email_lease_token,'SMTP de prueba');
  end loop;
  if not exists(select 1 from public.notifications where id=n1.id and email_status='fallido'
    and email_attempts=3 and email_last_error='SMTP de prueba') then raise exception 'Correo no quedo fallido'; end if;
  update public.notifications set email_status='pendiente' where id=n2.id;
  select * into claimed from public.claim_notification_email();
  perform public.finish_notification_email(n2.id,claimed.email_lease_token,null);
  if not exists(select 1 from public.notifications where id=n2.id and email_status='enviado' and email_attempts=1)
    or exists(select 1 from public.claim_notification_email()) then raise exception 'Correo enviado se volvio a reservar'; end if;

  -- Avisos de acciones en la misma transaccion; ofertas solo a elegibles.
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[1],f.students[1],(f.monday+time '09:00') at time zone 'America/Guayaquil','asignado') returning id into origin;
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[1],f.students[2],(f.monday+1+time '09:00') at time zone 'America/Guayaquil','asignado') returning id into other_origin;
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at)
    values(f.cohort,f.instructors[1],(f.monday+2+time '09:00') at time zone 'America/Guayaquil') returning id into target;
  value := public.cancel_practice_slot_with_reason(origin,f.students[1],'otro','No podre asistir a esa hora');
  if not exists(select 1 from public.notifications where user_id=f.students[1] and practice_slot_id=origin and tipo='resultado_cancelacion')
    then raise exception 'Cancelacion no persistida'; end if;
  if exists(select 1 from public.notifications where user_id in (f.students[1],f.students[3]) and practice_slot_id=origin and tipo='cupo_disponible')
    or not exists(select 1 from public.notifications where user_id=f.students[2] and practice_slot_id=origin and tipo='cupo_disponible')
    then raise exception 'Oferta sin elegibilidad por alumno'; end if;
  select count(*) into v_count from public.notifications where tipo='cupo_disponible';
  perform public.swap_practice_slot(origin,f.students[2],other_origin);
  if not exists(select 1 from public.notifications where user_id=f.students[2] and practice_slot_id=origin and tipo='cambio_realizado')
    or (select count(*) from public.notifications where tipo='cupo_disponible')<>v_count then raise exception 'Cambio no persistido o genero cascada'; end if;

  update public.practice_slots set scheduled_at=clock_timestamp()+interval '4 minutes' where id=s1.id;
  perform public.cancel_practice_slot_with_reason(s1.id,f.students[1],'otro','Aviso tardio para la prueba');
  if not exists(select 1 from public.notifications where user_id=f.instructors[1] and practice_slot_id=s1.id
    and tipo='sin_practica_instructor' and email_status='pendiente') then raise exception 'Falta aviso tardio al instructor'; end if;
  insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,status)
    values(f.cohort,f.instructors[1],clock_timestamp()+interval '3 minutes','liberado') returning id into closed;
  select xmin::text into version from public.practice_slots where id=closed;
  perform public.transition_practice_slot_for_scheduler(closed,'close',version);
  if not exists(select 1 from public.notifications where user_id=f.instructors[1] and practice_slot_id=closed and tipo='sin_practica_instructor')
    then raise exception 'Cierre T-5 sin aviso persistido'; end if;

  -- Una reserva abandonada se recupera con token nuevo; el token anterior no termina el envio.
  update public.notifications set email_status='pendiente', email_attempts=1,
    email_lease_token=gen_random_uuid(), email_locked_until=clock_timestamp()-interval '1 second',
    email_next_attempt_at=clock_timestamp()-interval '1 day' where id=n2.id returning * into n2;
  select * into claimed from public.claim_notification_email();
  if claimed.id<>n2.id or claimed.email_attempts<>2 or claimed.email_lease_token=n2.email_lease_token
    then raise exception 'No se recupero el correo abandonado'; end if;
  if public.finish_notification_email(n2.id,n2.email_lease_token,null) then raise exception 'Token vencido termino un envio nuevo'; end if;
  perform public.finish_notification_email(n2.id,claimed.email_lease_token,null);
  -- Un tercer intento abandonado no queda pendiente para siempre.
  update public.notifications set email_status='pendiente', email_attempts=3,
    email_lease_token=gen_random_uuid(), email_locked_until=clock_timestamp()-interval '1 second' where id=n2.id;
  -- El recordatorio de la practica cancelada no se entrega aunque antes haya fallado.
  update public.notifications set email_status='pendiente', email_attempts=0 where id=n1.id;
  perform public.claim_notification_email();
  if not exists(select 1 from public.notifications where id=n1.id and email_status='fallido' and email_attempts=0)
    or not exists(select 1 from public.notifications where id=n2.id and email_status='fallido' and email_attempts=3)
    then raise exception 'Recordatorio obsoleto o tercer intento abandonado sigue pendiente'; end if;

  -- Los otros resultados E1 tambien dejan bandeja sin crear correo adicional.
  update public.enrollments set practice_plan=jsonb_set(practice_plan,'{fechaFinElegida}',to_jsonb((f.monday-1)::text))
    where id=f.enrollments[3];
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[2],f.students[3],(f.monday+4+time '12:00') at time zone 'America/Guayaquil','asignado') returning id into extra;
  value := public.cancel_practice_slot_with_reason(extra,f.students[3],'otro','Aviso de hora perdida de prueba');
  if value->>'resultado'<>'hora_perdida' or not exists(select 1 from public.notifications where user_id=f.students[3]
    and practice_slot_id=extra and tipo='resultado_cancelacion' and mensaje like '%hora se pierde%' and email_status is null)
    then raise exception 'Hora perdida sin aviso de resultado'; end if;
  update public.enrollments set reprogramaciones_usadas=2 where id=f.enrollments[3];
  insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,status)
    values(f.cohort,f.instructors[2],f.students[3],(f.monday+5+time '12:00') at time zone 'America/Guayaquil','asignado') returning id into extra;
  value := public.cancel_practice_slot_with_reason(extra,f.students[3],'otro','Aviso sin mas reprogramaciones');
  if value->>'resultado'<>'falta' or not exists(select 1 from public.notifications where user_id=f.students[3]
    and practice_slot_id=extra and tipo='resultado_cancelacion' and mensaje like '%falta%') then raise exception 'Falta sin aviso'; end if;
  begin
    perform public.list_user_notifications(gen_random_uuid(),1,20);
    raise exception 'Cuenta inexistente accedio a bandeja';
  exception when sqlstate 'CD403' then null; end;
  perform private.enqueue_practice_notification(f.students[4],'cambio_realizado','Fixture','Aviso para verificar limpieza',target,clock_timestamp());
  delete from public.users where id=f.students[4];
  if exists(select 1 from public.notifications where user_id=f.students[4]) then raise exception 'La eliminacion del usuario dejo su bandeja'; end if;
end $$;
reset role;
rollback;
