begin;
set local lock_timeout='5s';
-- Rollback condicionado a los cuerpos instalados; nunca sobreescribir cambios ajenos.
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('student_practice_block_options_v14(uuid)')) is distinct from '8309997a78af2bd7d4bf8b073e1806da' then raise exception 'ROLLBACK_090: cuerpo desconocido: student_practice_block_options_v14(uuid)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('student_practice_block_summary_v14(uuid)')) is distinct from '209dbdd18865812ece2e054ceb902483' then raise exception 'ROLLBACK_090: cuerpo desconocido: student_practice_block_summary_v14(uuid)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('take_practice_block_v14(uuid,uuid,text)')) is distinct from 'a206d11976c334e90a31348071e8e0a0' then raise exception 'ROLLBACK_090: cuerpo desconocido: take_practice_block_v14(uuid,uuid,text)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.reserve_schedule_v2(uuid,uuid,jsonb)')) is distinct from '8a3a24737c168e6e681556688d5dd66a' then raise exception 'ROLLBACK_090: cuerpo desconocido: private.reserve_schedule_v2(uuid,uuid,jsonb)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)')) is distinct from '9291bb7618029eec0cf60cb43369fd3b' then raise exception 'ROLLBACK_090: cuerpo desconocido: private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.confirm_plan_change_v2(uuid,uuid,uuid)')) is distinct from '05a7e7af217d5516e536ee2d7725bafe' then raise exception 'ROLLBACK_090: cuerpo desconocido: private.confirm_plan_change_v2(uuid,uuid,uuid)';end if;end $guard$;
CREATE OR REPLACE FUNCTION private.reserve_schedule_v2(p_student uuid, p_enrollment uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare e public.enrollments;c public.cohorts;r public.student_schedule_reservations;
 plan jsonb;slots timestamptz[];t timestamptz;i uuid;v_now timestamptz;v_end timestamptz;
 cfg public.app_settings;price bigint;v_start date;v_last date;v_count int;v_last_expired timestamptz;
begin if private.enrollment_rule_enabled('reservations') then perform private.lock_student_schedule_v12(p_student);end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo and identity_access_blocked_at is null for update;
 if not found then perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 perform private.assert_student_not_deleting(p_student);
 perform private.expire_reservations_v2(p_student);
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student for update;
 if not found then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 select * into r from public.student_schedule_reservations where student_id=p_student and course_type=e.course_type
  and estado in ('vigente','pago_en_curso') for update;
 if found then return private.reservation_json_v2(r.id);end if;
 if e.status<>'pendiente_cohorte' or e.etapa_inscripcion<>'por_agendar' or e.requisitos_verificados_at is null then
  perform private.raise_cohort_error('RESERVA_ESTADO_NO_PERMITIDO');end if;
 plan:=private.enrollment_plan_v2(p_input);perform private.assert_enrollment_plan_future(plan,private.cohortes_now());
 if not exists(select 1 from public.enrollment_plan_options where modalidad=p_input->>'modalidad'
  and horas_por_dia=(p_input->>'horasPorDia')::int and habilitada) then
  perform private.raise_cohort_error('PLAN_OPCION_NO_OFERTADA');end if;
 select array_agg(value::timestamptz order by value::timestamptz) into slots from jsonb_array_elements_text(plan->'franjas');
 perform private.assert_own_schedule_v12(p_student,slots);v_start:=(plan->>'fechaInicioEfectiva')::date;v_last:=(plan->>'ultimaFecha')::date;
 -- Bloquear candidatas en orden estable; elegir después por fin e id.
 perform 1 from public.cohorts co join public.courses cu on cu.id=co.course_id where cu.tipo=e.course_type order by co.id for update of co;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 v_now:=private.cohortes_now();perform private.assert_enrollment_plan_future(plan,v_now);
 select * into cfg from public.app_settings where id;
 
 select precio_centavos into price from public.course_type_prices where tipo=e.course_type;
 if price is null then perform private.raise_cohort_error('PAGO_PRECIO_NO_CONFIGURADO');end if;
 select count(*),max(cerrada_at) into v_count,v_last_expired from public.student_schedule_reservations
  where student_id=p_student and estado='vencida' and
   (cerrada_at at time zone 'America/Guayaquil')::date=(v_now at time zone 'America/Guayaquil')::date;
 if v_count>=cfg.reservas_expiradas_dia or(v_count>0 and v_last_expired+make_interval(secs=>cfg.reserva_cooldown_segundos)>v_now) then
  perform private.raise_cohort_error('RESERVA_LIMITE_EXPIRADAS');end if;
 select co.* into c from public.cohorts co join public.courses cu on cu.id=co.course_id
  where cu.tipo=e.course_type and co.habilitada and co.cancelled_at is null
  and co.fecha_inicio_matricula<=co.fecha_fin_matricula and co.fecha_fin_matricula<=co.fecha_fin_curso
  and v_now>=co.fecha_inicio_matricula::timestamp at time zone 'America/Guayaquil'
  and v_now<(co.fecha_fin_matricula-4)::timestamp at time zone 'America/Guayaquil'
  and v_start>=co.fecha_inicio_curso and v_last<=co.fecha_fin_curso
  and private.cohort_peak_v2(co.id,v_start,v_last,e.id)<co.cupo_maximo
  order by co.fecha_fin_curso,co.id limit 1;
 if not found then perform private.raise_cohort_error('RESERVA_SIN_HORARIOS');end if;
 if exists(select 1 from public.practice_slots s cross join unnest(slots) requested(slot_at) where s.student_id=p_student
   and s.status in ('asignado','confirmado','completado') and abs(extract(epoch from(s.scheduled_at-requested.slot_at)))<3600) then
  perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO');end if;
 if exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations rr on rr.id=h.reservation_id cross join unnest(slots) requested_hold(slot_at) where rr.student_id=p_student and h.released_at is null and(h.payment_protected or h.expira_at>private.cohortes_now()) and abs(extract(epoch from(h.scheduled_at-requested_hold.slot_at)))<3600) then perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO');end if;
 v_end:=v_now+make_interval(mins=>cfg.reserva_ttl_minutos);
 insert into public.student_schedule_reservations(student_id,enrollment_id,cohort_id,course_type,creada_at,expira_at,
 modalidad,fecha_inicio,horas_por_dia,margen_dias,practice_start_date,practice_end_date,
 precio_snapshot_centavos,precio_snapshot_source,precio_snapshot_at,admission_at,admission_rule_version)
 values(p_student,e.id,c.id,e.course_type,v_now,v_end,p_input->>'modalidad',v_start,(p_input->>'horasPorDia')::int,0,
 v_start,v_last,price,'reservation_creation',v_now,v_now,'070') returning * into r;
 foreach t in array slots loop
  select id into i from private.free_instructors_v2(array[t],p_student,null) limit 1;
  if i is null then perform private.raise_cohort_error('RESERVA_RECURSO_OCUPADO');end if;
  perform 1 from public.users where id=i and rol='instructor' and activo for share;
  if not found then perform private.raise_cohort_error('CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE');end if;
  insert into public.student_schedule_holds(reservation_id,instructor_id,scheduled_at,held_from,expira_at)
   values(r.id,i,t,v_now,v_end);
 end loop;
 update public.enrollments set etapa_inscripcion='reservado',course_id=c.course_id,cohort_id=c.id,reserva_expira_at=v_end,
   practice_start_date=v_start,practice_end_date=v_last,access_end_date=v_last,
   individual_dates_source='reservation_holds',horas_practica_objetivo=(plan->>'totalHoras')::integer where id=e.id;
 insert into public.student_schedule_events(reservation_id,accion) values(r.id,'reservada');
 return private.reservation_json_v2(r.id);
end $function$
;
CREATE OR REPLACE FUNCTION private.confirm_payment_v2(p_id uuid, p_proveedor text, p_referencia text, p_resultado text, p_total bigint, p_moneda text, p_event text, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p public.payments;r public.student_schedule_reservations;e public.enrollments;event public.payment_events;
 sid uuid;ref text;reason text;h record;instructor uuid;chosen_slot uuid;v_state text;begin
 if p_resultado is null or p_resultado not in ('pendiente','rechazado','aprobado') or p_total is null or p_total<0
  or p_event is null or p_event !~ '^[a-f0-9]{64}$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
  or p_proveedor is null or p_proveedor not in ('simulado','manual','kushki')
  or (p_referencia is null and not(p_proveedor='kushki' and p_resultado='rechazado')) then
  perform private.raise_cohort_error('PAGO_ENTRADA_INVALIDA');end if;
 select student_id into sid from public.payments where id=p_id;
 if not found then perform private.raise_cohort_error('PAGO_NO_ENCONTRADO');end if;
 perform 1 from public.users where id=sid for update;
 perform 1 from public.enrollments where student_id=sid order by id for update;
 select * into r from public.student_schedule_reservations where id=(select reservation_id from public.payments where id=p_id) for update;
 select * into p from public.payments where id=p_id for update;
 ref:=coalesce(p_referencia,p.referencia,'kushki-rechazado:'||p.id::text);
 if p.proveedor<>p_proveedor or(p.referencia is not null and p.referencia<>ref and p.referencia not like 'kushki-rechazado:%') then
  perform private.raise_cohort_error('PAGO_REFERENCIA_CONFLICTO');end if;
 select * into event from public.payment_events where proveedor=p_proveedor and event_key=p_event;
 if found then
  if event.payment_id<>p.id or event.body_hash<>p_hash or event.resultado<>p_resultado then
   perform private.raise_cohort_error('PAGO_IDEMPOTENCIA_CONFLICTO');end if;
  return private.payment_json(p.id);
 end if;
 insert into public.payment_events(payment_id,proveedor,event_key,body_hash,resultado) values(p.id,p_proveedor,p_event,p_hash,p_resultado);
 if p.estado='aprobado' and p_total=p.total_centavos and p_moneda=p.moneda then return private.payment_json(p.id);end if;
 update public.payments set referencia=ref,recibido_centavos=p_total,recibido_moneda=p_moneda,updated_at=private.cohortes_now() where id=p.id;
 if p_resultado='pendiente' then return private.payment_json(p.id);end if;
 if p.estado='revision' then return private.payment_json(p.id);end if;
 if p_resultado='rechazado' then
  if p.estado='aprobado' then return private.payment_json(p.id);end if;
  update public.payments set estado='rechazado' where id=p.id;
  update public.student_schedule_holds set payment_protected=false where reservation_id=r.id;
  update public.student_schedule_reservations set estado='vigente' where id=r.id and estado='pago_en_curso';
  perform private.expire_reservations_v2(sid);
  return private.payment_json(p.id);
 end if;
 if p_total<>p.total_centavos or p_moneda is distinct from p.moneda then reason:='PAGO_MONTO_NO_COINCIDE';end if;
 if reason is null then begin
  if not exists(select 1 from public.users where id=sid and rol='estudiante' and activo and status in ('activo','verificado')) then
    perform private.raise_cohort_error('PAGO_CUENTA_NO_HABILITADA');end if;
  select * into e from public.enrollments where id=p.enrollment_id and student_id=sid;
  if e.id is null or e.requisitos_verificados_at is null or e.etapa_inscripcion<>'reservado'
   or r.estado<>'pago_en_curso' or r.admission_at is null or r.admission_at>r.creada_at
   or r.precio_snapshot_centavos is distinct from p.subtotal_centavos then
    perform private.raise_cohort_error('PAGO_APROBADO_SIN_RECURSOS');end if;
  perform 1 from public.cohorts where id=r.cohort_id for update;
  perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
  if (select count(*) from public.student_schedule_holds where reservation_id=r.id and released_at is null and payment_protected)<>e.horas_practica_objetivo
   or exists(select 1 from public.student_schedule_holds where reservation_id=r.id and scheduled_at<=private.cohortes_now()) then
    perform private.raise_cohort_error('PAGO_APROBADO_SIN_RECURSOS');end if;
  update public.student_schedule_holds set released_at=private.cohortes_now(),payment_protected=false where reservation_id=r.id;
  update public.users set status='activo' where id=sid and status='verificado';
  update public.enrollments set etapa_inscripcion='activa',status='activo',reserva_expira_at=null,
   monto_total=p.total_centavos::numeric/100,monto_abonado=p.total_centavos::numeric/100,paid_amount_centavos=p.total_centavos,
   practice_start_date=r.practice_start_date,practice_end_date=r.practice_end_date,access_end_date=r.practice_end_date,
   individual_dates_source='reservation_holds',horas_practica_objetivo=e.horas_practica_objetivo where id=e.id;
  for h in select * from public.student_schedule_holds where reservation_id=r.id order by scheduled_at loop
   select id into instructor from private.free_instructors_v2(array[h.scheduled_at],sid,r.id)
     order by (id=h.instructor_id) desc limit 1;
   if instructor is null then perform private.raise_cohort_error('PAGO_APROBADO_SIN_RECURSOS');end if;
   select id into chosen_slot from public.practice_slots where instructor_id=instructor and scheduled_at=h.scheduled_at
     and student_id is null and status in ('disponible','liberado') order by id limit 1 for update;
   if chosen_slot is not null then
    update public.practice_slots set student_id=sid,cohort_id=r.cohort_id,status='asignado' where id=chosen_slot;
   else
    insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status)
     values(r.cohort_id,instructor,sid,h.scheduled_at,60,'asignado');
   end if;
  end loop;
  update public.student_schedule_reservations set estado='confirmada',cerrada_at=private.cohortes_now() where id=r.id;
  insert into public.student_schedule_events(reservation_id,accion) values(r.id,'confirmada');
 exception when others then
  get stacked diagnostics v_state=returned_sqlstate;
  reason:=case when v_state='P7000' then 'PAGO_APROBADO_SIN_RECURSOS' else 'PAGO_ACTIVACION_REVISION' end;
 end;end if;
 if reason is not null then
  update public.payments set estado='revision',motivo_revision=reason,confirmed_at=private.cohortes_now() where id=p.id;
  insert into public.notifications(user_id,tipo,titulo,mensaje)
   select id,'cambio_realizado','Pago recibido: revisión necesaria','Hay un pago recibido que necesita revisión. No realices otro pago.'
    from public.users where id=sid;
  insert into public.notifications(user_id,tipo,titulo,mensaje)
   select id,'cambio_realizado','Pago requiere revisión','Revisar pago '||p.id::text||': '||reason
    from public.users u where rol='admin' and activo and exists(select 1 from public.enrollment_admin_permissions a where a.admin_id=u.id and a.permission='view_payments_invoices' and a.revoked_at is null);
 else
  update public.payments set estado='aprobado',confirmed_at=private.cohortes_now() where id=p.id;
  insert into public.payment_mail_outbox(payment_id) values(p.id) on conflict do nothing;
 end if;
 return private.payment_json(p.id);
end $function$
;
CREATE OR REPLACE FUNCTION private.confirm_plan_change_v2(p_student uuid, p_reservation uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare e public.enrollments;r public.student_schedule_reservations;h public.student_schedule_holds;i uuid;slot_id uuid;first_slot timestamptz;begin if private.enrollment_rule_enabled('reservations') then perform private.lock_student_schedule_v12(p_student);end if;
 if p_actor is not null then perform private.require_enrollment_permission(p_actor,'reassign_schedules');end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then perform private.raise_cohort_error('MATRICULA_CUENTA_NO_HABILITADA');end if;
 select * into r from public.student_schedule_reservations where id=p_reservation and student_id=p_student and replacement_enrollment_id is not null;
 if not found then perform private.raise_cohort_error('RESERVA_NO_ENCONTRADA');end if;
 select * into e from public.enrollments where id=r.enrollment_id and student_id=p_student for update;
 if r.estado='confirmada' then return private.reservation_json_v2(r.id);end if;
 perform private.assert_change_plan_v2(p_student,e.id,p_actor,r.change_is_reassignment);
 perform 1 from public.cohorts where id in(e.cohort_id,r.cohort_id) order by id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 select * into r from public.student_schedule_reservations where id=p_reservation for update;
 perform private.assert_change_plan_v2(p_student,e.id,p_actor,r.change_is_reassignment);
 if r.estado<>'vigente' or r.expira_at<=private.cohortes_now() then perform private.raise_cohort_error('PLAN_CAMBIO_RESERVA_VENCIDA');end if;
 if e.updated_at is distinct from(r.original_plan_snapshot->>'updated_at')::timestamptz then perform private.raise_cohort_error('PLAN_CAMBIO_VERSION_CONFLICTO');end if;
 if r.change_is_reassignment and p_actor is null then perform private.raise_cohort_error('PERMISO_REQUERIDO');end if;
 if (select count(*) from public.student_schedule_holds where reservation_id=r.id and released_at is null)<>coalesce((r.original_plan_snapshot->>'replacementTotalHours')::integer,e.horas_practica_objetivo) then perform private.raise_cohort_error('PLAN_CAMBIO_RETENCION_INCOMPLETA');end if;
 if exists(select 1 from public.student_schedule_holds retained join public.users u on u.id=retained.instructor_id where retained.reservation_id=r.id and(not u.activo or u.rol<>'instructor' or retained.scheduled_at<=private.cohortes_now())) then
  perform private.raise_cohort_error('CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE');end if;
 -- Liberar y reasignar dentro de la misma transacción; cualquier error revierte ambos.
 update public.student_schedule_holds set released_at=private.cohortes_now() where reservation_id=r.id;
 update public.practice_slots set student_id=null,status='liberado' where student_id=p_student and cohort_id=e.cohort_id and status in ('asignado','confirmado');
 update public.enrollments set cohort_id=r.cohort_id,course_id=(select course_id from public.cohorts where id=r.cohort_id),
 practice_start_date=r.practice_start_date,practice_end_date=r.practice_end_date,
 access_end_date=case when access_extended_at is null then r.practice_end_date else greatest(access_end_date,r.practice_end_date) end,
 individual_dates_source='reservation_holds',horas_practica_objetivo=coalesce((r.original_plan_snapshot->>'replacementTotalHours')::integer,e.horas_practica_objetivo) where id=e.id;
 for h in select * from public.student_schedule_holds where reservation_id=r.id order by scheduled_at loop
  i:=null;select id into i from private.free_instructors_v2(array[h.scheduled_at],p_student,r.id) order by(id=h.instructor_id) desc limit 1;
  if i is null then perform private.raise_cohort_error('RESERVA_RECURSO_OCUPADO');end if;
  slot_id:=null;select id into slot_id from public.practice_slots where instructor_id=i and scheduled_at=h.scheduled_at and student_id is null and status in ('disponible','liberado') order by id limit 1 for update;
  if slot_id is null then insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status) values(r.cohort_id,i,p_student,h.scheduled_at,60,'asignado');
  else update public.practice_slots set cohort_id=r.cohort_id,student_id=p_student,status='asignado' where id=slot_id;end if;
  first_slot:=least(coalesce(first_slot,h.scheduled_at),h.scheduled_at);
 end loop;
 update public.student_schedule_reservations set estado='confirmada',cerrada_at=private.cohortes_now(),change_confirmed_at=private.cohortes_now() where id=r.id;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
 values(coalesce(p_actor,p_student),case when r.change_is_reassignment then 'admin_reassignment_completed' else 'plan_change_confirmed' end,'enrollment',e.id::text,
 r.original_plan_snapshot,jsonb_build_object('reservationId',r.id,'cohortId',r.cohort_id,'practiceStart',r.practice_start_date,'practiceEnd',r.practice_end_date),r.change_reason);
 insert into public.notifications(user_id,tipo,titulo,mensaje,scheduled_at,domain_code,domain_entity_id,email_status)
 values(p_student,'plan_cambiado','Tu plan de prácticas fue actualizado','Tus prácticas empiezan el '||r.practice_start_date::text||' y terminan el '||r.practice_end_date::text||'. Consulta el horario completo en Mi inscripción.',first_slot,'PLAN_CAMBIO_CONFIRMADO',r.id,'pendiente')
 on conflict(user_id,domain_code,domain_entity_id) where domain_code is not null and domain_resolved_at is null do nothing;
 return private.reservation_json_v2(r.id);
end $function$
;
drop function public.take_practice_block_v14(uuid,uuid,text);
drop function public.student_practice_block_summary_v14(uuid);
drop function public.student_practice_block_options_v14(uuid);

notify pgrst, 'reload schema';
commit;
