-- MANUAL: revierte 064. Restaura los cuerpos ORIGINALES (058/059/060/022) y elimina courses.precio y
-- private.precio_curso. Los precios por tipo se pierden (cohorts.precio vuelve a ser la fuente).
-- Si ya hay cohortes con precio NULL (creadas tras 064), se DETIENE: asignarles un precio manualmente
-- antes de revertir; este script no inventa datos. Coordinar con el despliegue de API/web.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date)')) not in ('c4eab19a0d0a909b73e7ca8c9a9446c2','5b939e177c1736cb32ac428816004493') then
  raise exception '064 rollback: falta función o cuerpo distinto: public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date)';end if;
 if to_regprocedure('public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text)')) not in ('43aa977085039a6e707f78f10bc1225e','b45d2bcd91e6a25c2b41caaadaa632bd') then
  raise exception '064 rollback: falta función o cuerpo distinto: public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text)';end if;
 if to_regprocedure('public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text)')) not in ('e812f7becade587b99bb62582907009d','9f35fccc54d2dbbeef3480ecd69e165e') then
  raise exception '064 rollback: falta función o cuerpo distinto: public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text)';end if;
 if to_regprocedure('public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb)')) not in ('9c73e150d35de08694bb475f0862228e','aa1e88f45ef7afd43c167de9f2d46a67') then
  raise exception '064 rollback: falta función o cuerpo distinto: public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb)';end if;
 if to_regprocedure('public.update_manual_enrollment_details(uuid,uuid,jsonb,jsonb)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.update_manual_enrollment_details(uuid,uuid,jsonb,jsonb)')) not in ('188286b9e26564713336b6ab9d6be976','3b9018621fc8029e2f2c5c4c80899294') then
  raise exception '064 rollback: falta función o cuerpo distinto: public.update_manual_enrollment_details(uuid,uuid,jsonb,jsonb)';end if;
 if to_regprocedure('public.guard_cohort_schedule_reservations()') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.guard_cohort_schedule_reservations()')) not in ('ccebbc6febb0dfb180fc6ee4dbd41d71','3f910a4c6de29f0609f543cb70f736bb') then
  raise exception '064 rollback: falta función o cuerpo distinto: public.guard_cohort_schedule_reservations()';end if;
end $$;
do $$ begin
 if exists(select 1 from public.cohorts where precio is null) then
  raise exception '064 rollback: hay cohortes con precio NULL; asígnales precio antes de restaurar NOT NULL';end if;
end $$;
create or replace function public.assign_pending_enrollment_cohort(
  p_actor uuid, p_student uuid, p_enrollment uuid, p_cohort uuid,
  p_cohort_version timestamptz, p_validated_day date
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.enrollments; c public.cohorts; v_active boolean; v_net numeric;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  if p_actor is null or p_student is null or p_enrollment is null or p_cohort is null then
    raise exception 'Asignación inválida' using errcode='22023'; end if;

  -- Mismo orden que B/D: alumno antes de matrícula; cohorte al final.
  select activo into v_active from public.users
    where id=p_student and rol='estudiante' for share;
  if not found then raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
  perform private.assert_student_not_deleting(p_student);
  if not v_active then raise exception 'Cuenta inactiva' using errcode='CD403'; end if;
  select * into e from public.enrollments
    where id=p_enrollment and student_id=p_student for update;
  if not found then raise exception 'Matrícula no encontrada' using errcode='CD040'; end if;
  if e.origen='solicitud' and e.etapa_inscripcion<>'activa' then
    raise exception 'El alumno debe reservar y pagar antes de asignar cohorte' using errcode='IE403';end if;
  if e.status='activo' and e.cohort_id=p_cohort then return to_jsonb(e); end if;
  if e.status<>'pendiente_cohorte' then
    raise exception 'La matrícula ya no está pendiente de cohorte' using errcode='CD041'; end if;

  select * into c from public.cohorts where id=p_cohort for update;
  if not found then raise exception 'Cohorte no encontrada' using errcode='CD042'; end if;
  if c.course_id<>e.course_id then
    raise exception 'La cohorte no corresponde al curso' using errcode='CD043'; end if;
  if p_cohort_version is null or p_validated_day is null then
    raise exception 'Falta validación de ventana' using errcode='22023'; end if;
  -- Reloj leído DESPUÉS de esperar todos los locks. No repetir el predicado de ventana.
  if c.updated_at is distinct from p_cohort_version or
    (clock_timestamp() at time zone 'America/Guayaquil')::date is distinct from p_validated_day then
    raise exception 'La cohorte o el día cambiaron; recarga antes de confirmar' using errcode='CD044'; end if;
  v_net:=c.precio-e.descuento;
  if v_net<0 or e.monto_abonado>v_net then
    raise exception 'El abono supera el neto de la cohorte' using errcode='CD045'; end if;
  -- El trigger enforce_cohort_cupo revalida cupo bajo este mismo lock (CD001).
  update public.enrollments set cohort_id=p_cohort,status='activo',monto_total=v_net,
    cohort_assigned_by=p_actor,cohort_assigned_at=clock_timestamp()
    where id=e.id returning * into e;
  return to_jsonb(e);
end $$;
create or replace function public.begin_student_payment(p_student uuid,p_reserva uuid,p_proveedor text,p_attempt uuid,
 p_recargo integer default 0,p_gracia integer default 10,p_actor uuid default null,p_comprobante text default null)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.student_schedule_reservations;e public.enrollments;c public.cohorts;p public.payments;v jsonb;begin
 if p_attempt is null or p_proveedor is null or p_proveedor not in ('simulado','manual','kushki')
 or p_recargo is null or p_recargo not between 0 and 1000000 or p_gracia is null or p_gracia not between 1 and 10
 or length(coalesce(p_comprobante,''))>160 then raise exception 'Intento de pago inválido' using errcode='22023';end if;
 if p_proveedor='manual' and not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then
 raise exception 'Solo un administrador registra efectivo' using errcode='42501';end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo and status in ('verificado','activo') for update;
 if not found then raise exception 'Cuenta no habilitada para pagar' using errcode='IP403';end if;
 perform private.assert_student_not_deleting(p_student);
 perform 1 from public.enrollments where student_id=p_student order by id for update;
 select * into p from public.payments where attempt_key=p_attempt;
 if found then
 if p.student_id is distinct from p_student or p.reservation_id is distinct from p_reserva or p.proveedor<>p_proveedor then
 raise exception 'La clave pertenece a otro intento' using errcode='IP409';end if;
 return private.payment_json(p.id);end if;
 perform public.expire_student_reservations(p_student);
 select * into r from public.student_schedule_reservations where id=p_reserva and student_id=p_student for update;
 if not found then raise exception 'Reserva no encontrada' using errcode='IP404';end if;
 select * into e from public.enrollments where id=r.enrollment_id and student_id=p_student;
 if e.origen<>'solicitud' or e.etapa_inscripcion<>'reservado' or e.status<>'pendiente_cohorte'
 or e.requisitos_verificados_at is null then raise exception 'Matrícula no habilitada para pago' using errcode='IP403';end if;
 if exists(select 1 from public.payments where enrollment_id=e.id and estado in ('pendiente','aprobado','revision')) then
 raise exception 'Hay un pago pendiente, recibido o en revisión' using errcode='IP410';end if;
 select * into c from public.cohorts where id=r.cohort_id for update;
 if r.estado not in ('vigente','pago_en_curso') or r.expira_at<=clock_timestamp()
 or exists(select 1 from public.student_schedule_holds where reservation_id=r.id and scheduled_at<=clock_timestamp()) then
 raise exception 'Reserva vencida' using errcode='IP411';end if;
 -- El precio y el recargo salen de la configuración/BD del servidor, jamás del navegador.
 v:=public.manage_student_reservation(p_student,'iniciar_pago',r.id,10,1,p_gracia);
 if v->>'estado'<>'pago_en_curso' then raise exception 'Reserva vencida' using errcode='IP411';end if;
 insert into public.payments(student_id,enrollment_id,reservation_id,attempt_key,proveedor,subtotal_centavos,
 recargo_centavos,total_centavos,actor_id,comprobante)
 values(p_student,e.id,r.id,p_attempt,p_proveedor,round(c.precio*100)::bigint,p_recargo,
 round(c.precio*100)::bigint+p_recargo,p_actor,nullif(btrim(p_comprobante),'')) returning * into p;
 return private.payment_json(p.id);
end $$;
create or replace function public.confirm_student_payment(p_id uuid,p_proveedor text,p_referencia text,p_resultado text,
 p_total bigint,p_moneda text,p_event text,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare p public.payments;r public.student_schedule_reservations;e public.enrollments;c public.cohorts;
 ev public.payment_events;v_student uuid;v_error text;v_revision text;v_count integer;v_day date;v_referencia text;begin
 if p_resultado is null or p_resultado not in ('pendiente','rechazado','aprobado') or p_proveedor is null
 or p_total is null or p_total<0 or p_total>10001000000 or p_moneda is null or length(p_moneda)>8
 or(p_referencia is null and not(p_proveedor='kushki' and p_resultado='rechazado'))
 or(p_referencia is not null and p_referencia !~ '^[A-Za-z0-9_.:-]{1,200}$')
 or p_event is null or p_event !~ '^[a-f0-9]{64}$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
 raise exception 'Evento de pago inválido' using errcode='22023';end if;
 select student_id into v_student from public.payments where id=p_id;
 if not found then raise exception 'Pago no encontrado' using errcode='IP404';end if;
 -- Orden compartido con reservar/desactivar/expirar: usuario→matrículas→reserva→pago→cohorte.
 perform 1 from public.users where id=v_student for update;
 perform 1 from public.enrollments where student_id=v_student order by id for update;
 select * into r from public.student_schedule_reservations where id=(select reservation_id from public.payments where id=p_id) for update;
 select * into p from public.payments where id=p_id for update;
 -- Resolver falta de ticket DENTRO del lock: no compite con el ticket HTTP tardío.
 v_referencia:=case when p_proveedor='kushki' and p_resultado='rechazado'
  and(p_referencia is null or p_referencia='kushki-rechazado:'||p.id::text)
  then coalesce(p.referencia,'kushki-rechazado:'||p.id::text) else p_referencia end;
 if p.proveedor<>p_proveedor or(p.referencia is not null and p.referencia<>v_referencia
  and not(p_proveedor='kushki' and p.referencia='kushki-rechazado:'||p.id::text)) then
 raise exception 'Proveedor o referencia no corresponde' using errcode='IP409';end if;
 select * into ev from public.payment_events where proveedor=p_proveedor and event_key=p_event;
 if found then
 if ev.payment_id<>p.id or ev.body_hash<>p_hash or ev.resultado<>p_resultado then
 raise exception 'Evento repetido con contenido distinto' using errcode='IP409';end if;
 return private.payment_json(p.id);end if;
 insert into public.payment_events(payment_id,proveedor,event_key,body_hash,resultado)
 values(p.id,p_proveedor,p_event,p_hash,p_resultado);
 -- Un evento no puede adjudicar una referencia ya usada por otro pago.
 -- Guardar lo reportado también en pendientes/rechazos; solo una aprobación
 -- confronta importe/moneda con el snapshot. Un aviso posterior no desactiva una cuenta.
 update public.payments set referencia=v_referencia,recibido_centavos=p_total,recibido_moneda=p_moneda,
 updated_at=clock_timestamp() where id=p.id;
 if p.estado in ('aprobado','revision') then
 if p_resultado<>'aprobado' or(p_total=p.total_centavos and p_moneda=p.moneda) then
 return private.payment_json(p.id);end if;
 v_revision:='MONTO_NO_COINCIDE';end if;
 if p_resultado='pendiente' then return private.payment_json(p.id);end if;
 if p_resultado='rechazado' then
 update public.payments set estado='rechazado',recibido_centavos=p_total,recibido_moneda=p_moneda,updated_at=clock_timestamp() where id=p.id;
 -- Puede intentar otra vez dentro del MISMO vencimiento, sin nueva gracia ni ampliación.
 update public.student_schedule_reservations set estado='vigente' where id=r.id and estado='pago_en_curso' and expira_at>clock_timestamp();
 return private.payment_json(p.id);end if;
 if p_total<>p.total_centavos or p_moneda<>p.moneda then v_revision:='MONTO_NO_COINCIDE';end if;
 -- Subtransacción: si no se puede activar, el dinero/evento persisten en revisión.
 if v_revision is null then begin
 if not exists(select 1 from public.users where id=v_student and rol='estudiante' and activo and status in ('verificado','activo')) then
 raise exception 'Cuenta no activable' using errcode='IP403';end if;
 perform private.assert_student_not_deleting(v_student);
 select * into e from public.enrollments where id=p.enrollment_id and student_id=v_student;
 if not found or e.origen<>'solicitud' or e.etapa_inscripcion='activa' or e.requisitos_verificados_at is null then
 raise exception 'Matrícula no activable' using errcode='IP403';end if;
 if r.id is null or r.estado='liberada' or r.estado='confirmada' or exists(
 select 1 from public.student_schedule_reservations where student_id=v_student and id<>r.id and estado in ('vigente','pago_en_curso') and expira_at>clock_timestamp())
 or exists(select 1 from public.payments where enrollment_id=e.id and id<>p.id and estado in ('pendiente','aprobado','revision')) then
 raise exception 'Horario o pago nuevo requiere revisión' using errcode='IP409';end if;
 select * into c from public.cohorts where id=r.cohort_id for update;
 v_day:=(clock_timestamp() at time zone 'America/Guayaquil')::date;
 select count(*) into v_count from public.student_schedule_holds where reservation_id=r.id;
 if c.id is null or c.course_id<>e.course_id or round(c.precio*100)::bigint<>p.subtotal_centavos
 or v_day not between c.fecha_inicio_matricula and c.fecha_fin_matricula
 or v_count<>(select horas_requeridas from public.courses where id=e.course_id) or v_count=0
 or exists(select 1 from public.student_schedule_holds h where h.reservation_id=r.id and (
 h.scheduled_at<=clock_timestamp() or (h.scheduled_at at time zone 'America/Guayaquil')::date<c.fecha_inicio_curso
 or (h.scheduled_at at time zone 'America/Guayaquil')::date>c.fecha_fin_curso-r.margen_dias)) then
 raise exception 'Cohorte o plan cambió' using errcode='IP409';end if;
 -- El trigger058 revalida cupo excluyendo esta matrícula (reserva→activa no duplica).
 update public.users set status='activo' where id=v_student and status='verificado';
 update public.enrollments set etapa_inscripcion='activa',status='activo',cohort_id=c.id,
 reserva_expira_at=null,monto_total=p.total_centavos::numeric/100,monto_abonado=p.total_centavos::numeric/100,
 horas_practica_objetivo=v_count where id=e.id;
 perform private.confirm_student_reservation(v_student,r.id);
 exception when others then get stacked diagnostics v_error=returned_sqlstate;
 v_revision:='ACTIVACION_'||v_error;
 end;end if;
 if v_revision is not null then
 update public.payments set estado='revision',motivo_revision=v_revision,recibido_centavos=p_total,recibido_moneda=p_moneda,
 updated_at=clock_timestamp(),confirmed_at=clock_timestamp() where id=p.id;
 insert into public.notifications(user_id,tipo,titulo,mensaje)
 select id,'cambio_realizado','Pago recibido: requiere revisión',
 'Se recibió un pago que requiere revisión administrativa. No realices otro pago; contacta a la escuela.'
 from public.users where id=v_student;
 insert into public.notifications(user_id,tipo,titulo,mensaje)
 select id,'cambio_realizado','Pago de inscripción en revisión','Revisa el pago '||p.id::text||' antes de activar la matrícula.'
 from public.users where rol='admin' and activo;
 else
 update public.payments set estado='aprobado',recibido_centavos=p_total,recibido_moneda=p_moneda,
 updated_at=clock_timestamp(),confirmed_at=clock_timestamp() where id=p.id;
 insert into public.notifications(user_id,tipo,titulo,mensaje) values(v_student,'cambio_realizado',
 'Tu matrícula está activa','El pago fue confirmado. Ya puedes consultar tus prácticas y acceder a la plataforma.');
 insert into public.payment_mail_outbox(payment_id) values(p.id) on conflict do nothing;
 end if;
 return private.payment_json(p.id);
end $$;
create or replace function public.commit_manual_enrollment(
  p_id uuid, p_worker uuid, p_student uuid, p_profile jsonb, p_course uuid,
  p_cohort uuid, p_plan jsonb, p_scheduled_ats timestamptz[], p_instructor uuid,
  p_documents jsonb, p_payment jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare op public.manual_enrollment_operations; c public.cohorts;
  e public.enrollments; v_type public.course_type; v_slots integer := 0;
  v_response jsonb; v_discount numeric; v_paid numeric; v_net numeric;
  v_birth date; v_senior boolean; v_doc jsonb; v_seen jsonb := '{}'::jsonb;
  v_document_type text; v_status text; v_pending integer;
begin
  select * into op from public.manual_enrollment_operations where id=p_id for update;
  if not found or op.phase <> 'processing' or op.worker_id <> p_worker then
    raise exception 'Operación no reservada por este proceso' using errcode='CD021';
  end if;
  if not exists(select 1 from public.users where id=op.actor_id and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  select tipo into strict v_type from public.courses where id=p_course;
  if p_cohort is not null then
    select * into strict c from public.cohorts where id=p_cohort for update;
    if c.course_id <> p_course then raise exception 'Cohorte de otro curso' using errcode='CD020'; end if;
    if (clock_timestamp() at time zone 'America/Guayaquil')::date
      not between c.fecha_inicio_matricula and c.fecha_fin_matricula then
      raise exception 'La matrícula de la cohorte ya no está abierta' using errcode='CD020';
    end if;
  elsif cardinality(p_scheduled_ats)>0 then
    raise exception 'Una matrícula pendiente no puede generar franjas' using errcode='CD020';
  end if;

  if p_payment is null or jsonb_typeof(p_payment) <> 'object'
     or p_payment->>'modalidad' is null or p_payment->>'modalidad' not in ('abono','completo')
     or p_payment->>'descuento' is null or p_payment->>'montoAbonado' is null then
    raise exception 'Pago inicial inválido' using errcode='CD025';
  end if;
  v_discount := (p_payment->>'descuento')::numeric;
  v_paid := (p_payment->>'montoAbonado')::numeric;
  if v_discount < 0 or v_paid < 0 or scale(v_discount)>2 or scale(v_paid)>2 then
    raise exception 'Los montos deben ser no negativos y tener hasta dos decimales' using errcode='CD025';
  end if;
  if p_cohort is null then
    if v_discount <> 0 or p_payment->>'modalidad' <> 'abono' then
      raise exception 'Sin cohorte solo se permite abono y descuento cero' using errcode='CD025';
    end if;
    v_net := null;
  else
    if v_discount > c.precio then
      raise exception 'El descuento supera el precio de la cohorte' using errcode='CD025';
    end if;
    v_net := c.precio - v_discount;
    if v_paid > v_net or
      (p_payment->>'modalidad' = 'completo' and v_paid <> v_net) or
      (p_payment->>'modalidad' = 'abono' and v_paid = v_net and v_net > 0) then
      raise exception 'El abono no corresponde al monto total neto' using errcode='CD025';
    end if;
  end if;
  if p_documents is null or jsonb_typeof(p_documents) <> 'array'
     or jsonb_array_length(p_documents) <> 4 then
    raise exception 'Se requieren los cuatro documentos' using errcode='CD026';
  end if;

  if p_profile is not null then
    if op.student_id is distinct from p_student or not op.student_created then
      raise exception 'Cuenta nueva no registrada en la operación' using errcode='CD021';
    end if;
    insert into public.users(id,cedula,nombre_completo,telefono,rol,debe_cambiar_password,fecha_nacimiento)
    values(p_student,p_profile->>'cedula',p_profile->>'nombreCompleto',nullif(p_profile->>'telefono',''),
      'estudiante',true,(p_profile->>'fechaNacimiento')::date);
  elsif op.student_created then
    raise exception 'Falta perfil de la cuenta nueva' using errcode='CD021';
  end if;
  select fecha_nacimiento into v_birth from public.users where id=p_student;
  v_senior := v_birth is not null and
    date_part('year', age((clock_timestamp() at time zone 'America/Guayaquil')::date, v_birth)) >= 65;

  insert into public.enrollments(student_id,course_id,course_type,cohort_id,status,
    monto_total,descuento,monto_abonado,practice_plan)
    values(p_student,p_course,v_type,p_cohort,
      case when p_cohort is null then 'pendiente_cohorte'::public.enrollment_status
        else 'activo'::public.enrollment_status end,
      v_net,v_discount,v_paid,p_plan) returning * into e;
  for v_doc in select value from jsonb_array_elements(p_documents) loop
    v_document_type := v_doc->>'tipo';
    v_status := v_doc->>'estado';
    if v_document_type is null or v_document_type not in
      ('cedula','papeleta_votacion','tipo_sangre','titulo_bachiller')
      or v_status is null or v_status not in ('entregado','pendiente','no_aplica')
      or v_seen ? v_document_type then
      raise exception 'Checklist inválido o repetido' using errcode='CD026';
    end if;
    v_seen := v_seen || pg_catalog.jsonb_build_object(v_document_type,true);
    if v_senior and v_document_type = 'papeleta_votacion' then v_status := 'no_aplica'; end if;
    update public.enrollment_documents set estado=v_status,
      fecha_marcado=case when v_status <> 'pendiente' and not (v_senior and v_document_type='papeleta_votacion')
        then clock_timestamp() else null end,
      marcado_por=case when v_status <> 'pendiente' and not (v_senior and v_document_type='papeleta_votacion')
        then op.actor_id else null end
    where enrollment_id=e.id and tipo=v_document_type;
    if not found then raise exception 'Checklist incompleto' using errcode='CD026'; end if;
  end loop;
  if cardinality(p_scheduled_ats)>0 then
    insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status)
      select p_cohort,p_instructor,p_student,t,60,'asignado' from unnest(p_scheduled_ats) t;
    get diagnostics v_slots = row_count;
  end if;
  select count(*) into v_pending from public.enrollment_documents
    where enrollment_id=e.id and estado='pendiente';
  v_response := jsonb_build_object('operationId',p_id,'studentId',p_student,'studentCreated',op.student_created,
    'enrollmentId',e.id,'courseId',p_course,'courseType',v_type,'cohortId',p_cohort,'status',e.status,
    'slotsCreated',v_slots,'plan',p_plan,'montoTotal',v_net,'descuento',v_discount,
    'montoAbonado',v_paid,'saldo',case when v_net is null then null else v_net-v_paid end,
    'documentosPendientes',v_pending);
  update public.manual_enrollment_operations set phase='committed',response=v_response,
    student_id=p_student,updated_at=now() where id=p_id;
  return v_response;
end $$;
create or replace function public.update_manual_enrollment_details(
  p_enrollment uuid, p_actor uuid, p_documents jsonb, p_payment jsonb
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare e public.enrollments; v_price numeric; v_discount numeric; v_paid numeric;
  v_net numeric; v_birth date; v_senior boolean; v_doc jsonb;
  v_seen jsonb := '{}'::jsonb; v_type text; v_status text;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  select * into e from public.enrollments where id=p_enrollment for update;
  if not found then raise exception 'Matrícula no encontrada' using errcode='CD027'; end if;
  if p_payment is not null then
    if jsonb_typeof(p_payment) <> 'object' or p_payment->>'modalidad' is null
      or p_payment->>'modalidad' not in ('abono','completo')
      or p_payment->>'descuento' is null or p_payment->>'montoAbonado' is null then
      raise exception 'Pago inicial inválido' using errcode='CD025';
    end if;
    v_discount := (p_payment->>'descuento')::numeric;
    v_paid := (p_payment->>'montoAbonado')::numeric;
    if v_discount < 0 or v_paid < 0 or scale(v_discount)>2 or scale(v_paid)>2 then
      raise exception 'Los montos deben ser no negativos y tener hasta dos decimales' using errcode='CD025';
    end if;
    if e.cohort_id is null then
      if v_discount <> 0 or p_payment->>'modalidad' <> 'abono' then
        raise exception 'Sin cohorte solo se permite abono y descuento cero' using errcode='CD025';
      end if;
      v_net := null;
    else
      select precio into v_price from public.cohorts where id=e.cohort_id for update;
      if not found then raise exception 'Cohorte no encontrada' using errcode='CD027'; end if;
      if v_discount > v_price then
        raise exception 'El descuento supera el precio de la cohorte' using errcode='CD025';
      end if;
      v_net := v_price-v_discount;
      if v_paid > v_net or
        (p_payment->>'modalidad'='completo' and v_paid<>v_net) or
        (p_payment->>'modalidad'='abono' and v_paid=v_net and v_net>0) then
        raise exception 'El abono no corresponde al monto total neto' using errcode='CD025';
      end if;
    end if;
    update public.enrollments set monto_total=v_net,descuento=v_discount,monto_abonado=v_paid
      where id=p_enrollment;
  end if;
  if p_documents is not null then
    if jsonb_typeof(p_documents) <> 'array' or jsonb_array_length(p_documents)>4 then
      raise exception 'Checklist inválido' using errcode='CD026';
    end if;
    select fecha_nacimiento into v_birth from public.users where id=e.student_id;
    v_senior := v_birth is not null and
      date_part('year', age((clock_timestamp() at time zone 'America/Guayaquil')::date, v_birth)) >= 65;
    for v_doc in select value from jsonb_array_elements(p_documents) loop
      v_type := v_doc->>'tipo'; v_status := v_doc->>'estado';
      if v_type is null or v_type not in
        ('cedula','papeleta_votacion','tipo_sangre','titulo_bachiller')
        or v_status is null or v_status not in ('entregado','pendiente','no_aplica')
        or v_seen ? v_type then
        raise exception 'Checklist inválido o repetido' using errcode='CD026';
      end if;
      v_seen := v_seen || pg_catalog.jsonb_build_object(v_type,true);
      if v_senior and v_type='papeleta_votacion' then v_status := 'no_aplica'; end if;
      update public.enrollment_documents set estado=v_status,
        fecha_marcado=case when v_senior and v_type='papeleta_votacion' then null else clock_timestamp() end,
        marcado_por=case when v_senior and v_type='papeleta_votacion' then null else p_actor end
      where enrollment_id=p_enrollment and tipo=v_type;
      if not found then raise exception 'Checklist incompleto' using errcode='CD026'; end if;
    end loop;
  end if;
  return true;
end $$;
create or replace function public.guard_cohort_schedule_reservations() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if exists(select 1 from public.student_schedule_reservations r join public.student_schedule_holds h on h.reservation_id=r.id
 where r.cohort_id=new.id and r.estado in ('vigente','pago_en_curso') and r.expira_at>clock_timestamp()
 and(new.course_id<>old.course_id or new.precio<>old.precio
 or (h.scheduled_at at time zone 'America/Guayaquil')::date<new.fecha_inicio_curso
 or (h.scheduled_at at time zone 'America/Guayaquil')::date>new.fecha_fin_curso-r.margen_dias)) then
 raise exception 'La cohorte tiene reservas vigentes; conserva curso, precio y fechas compatibles' using errcode='IR413';end if;
 return new;
end $$;
alter table public.cohorts alter column precio set not null;
comment on column public.cohorts.precio is
 'Precio de esta cohorte específica. Cohortes del mismo curso pueden tener precios distintos.';
drop function if exists private.precio_curso(uuid);
alter table public.courses drop constraint if exists courses_precio_rango;
alter table public.courses drop column if exists precio;
notify pgrst,'reload schema';
commit;
