-- C08. Solo oferta y nuevos planes; ninguna matrícula existente se actualiza.
begin;
set local lock_timeout='5s';
do $constraint_guard$ declare definition text;begin
 select pg_get_constraintdef(oid) into definition from pg_constraint
 where conrelid='public.enrollment_plan_options'::regclass and conname='enrollment_plan_options_horas_objetivo_check';
 if definition is distinct from 'CHECK ((horas_objetivo = 15))' then
  raise exception 'GUARDA_086_RESTRICCION: se esperaba CHECK ((horas_objetivo = 15)); encontrado: %',coalesce(definition,'AUSENTE');
 end if;
end $constraint_guard$;
alter table public.enrollment_plan_options drop constraint enrollment_plan_options_horas_objetivo_check;
update public.enrollment_plan_options set horas_objetivo=10,
 habilitada=(modalidad='entre_semana' and horas_por_dia in(1,2)) or(modalidad='fin_de_semana' and horas_por_dia=2),
 motivo='Plan de 10 horas, decisión del dueño 12/11/2026';
update public.courses set horas_requeridas=10 where tipo in('A','B');
alter table public.enrollment_plan_options add constraint enrollment_plan_options_horas_objetivo_check check (horas_objetivo > 0);
alter table public.enrollment_plan_options alter column horas_objetivo set default 10;
-- GUARDA-MD5 INICIO: md5(replace(prosrc,chr(13),''))
do $guard$ declare g record;begin
 for g in select * from (values
  ('private.enrollment_plan_v2(jsonb)','275869129957f6cf838783efeeb98b6b'),
  ('private.reserve_schedule_v2(uuid,uuid,jsonb)','be937a1c439a4560074a33058cc44bad'),
  ('private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)','6e9505424bddc57b6b3dd5ae765db688'),
  ('private.mark_payment_dates_proven()','dfbfa45f06c15fca9ed374d339810ae3'),
  ('authorize_repeat_enrollment_v2(uuid,uuid,uuid,text)','2c32f1bf4c498d7545b3644f61df25ec'),
  ('private.reserve_plan_change_v2(uuid,uuid,jsonb,uuid,text,boolean,uuid)','8f2564cfd6ed9e03085745c53e13d8c0'),
  ('private.confirm_plan_change_v2(uuid,uuid,uuid)','910b76ac285d3652da3b4ededc8edd01'),
  ('private.integrated_manual_commit_v2(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamp with time zone[],uuid,jsonb,jsonb)','7a72553f201af934856b949e42fef9a9')
 ) v(sig,h) loop
  if to_regprocedure(g.sig) is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(g.sig)) is distinct from g.h then
   raise exception 'GUARDA_086: % no coincide con el cuerpo esperado',g.sig;
  end if;
 end loop;
end $guard$;
-- GUARDA-MD5 FIN

CREATE OR REPLACE FUNCTION private.enrollment_plan_v2(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_start date; v_day date; v_mode text; v_hours int; v_hour int; v_left int;v_total int;
 v_limit int:=coalesce((select practicas_hora_fin from public.app_settings where id),22);v_n int; v_i int; v_slots jsonb:='[]'; v_days jsonb:='[]'; v_first date; v_last date;
begin
 v_start:=private.lote1_date(p_input->>'fechaInicio');v_mode:=p_input->>'modalidad';
 if v_start is null or v_mode is null or v_mode not in ('entre_semana','fin_de_semana')
  or coalesce(p_input->>'horasPorDia','') !~ '^[1-6]$'
  or coalesce(p_input->>'horaInicio','') !~ '^([0-9]|1[0-9]|2[0-3])$' then
  perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 v_hours:=(p_input->>'horasPorDia')::int;v_hour:=(p_input->>'horaInicio')::int;
 if v_hour<6 or v_hour+v_hours>v_limit then perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 select horas_objetivo into v_total from public.enrollment_plan_options
 where modalidad=v_mode and horas_por_dia=v_hours and habilitada;
 if not found or v_total is null or v_total<=0 then perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 v_left:=v_total;
 v_day:=v_start;
 while v_left>0 loop
  if (v_mode='entre_semana' and extract(isodow from v_day) between 1 and 5)
    or (v_mode='fin_de_semana' and extract(isodow from v_day) in (6,7)) then
   v_n:=least(v_left,v_hours);v_first:=coalesce(v_first,v_day);v_last:=v_day;
   v_days:=v_days||jsonb_build_array(jsonb_build_object('fecha',v_day,'horas',v_n));
   for v_i in 0..v_n-1 loop
    v_slots:=v_slots||jsonb_build_array(to_char((v_day::timestamp+make_interval(hours=>v_hour+v_i))
      at time zone 'America/Guayaquil' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
   end loop;
   v_left:=v_left-v_n;
  end if;
  v_day:=v_day+1;
 end loop;
 return jsonb_build_object('fechaInicioEfectiva',v_first,'ultimaFecha',v_last,'totalHoras',v_total,'dias',v_days,'franjas',v_slots);
end $function$
;
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
CREATE OR REPLACE FUNCTION private.mark_payment_dates_proven()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin
 if new.estado='aprobado' then
  update public.enrollments e set individual_dates_guard_ready=true from public.student_schedule_reservations r
  where r.id=new.reservation_id and new.enrollment_id=e.id and r.admission_rule_version='070' and not e.individual_dates_guard_ready and e.individual_dates_source='reservation_holds'
  and e.practice_start_date=r.practice_start_date and e.practice_end_date=r.practice_end_date and e.paid_amount_centavos=new.total_centavos
  and(select count(*) from public.student_schedule_holds where reservation_id=r.id)=e.horas_practica_objetivo;
 end if;return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.authorize_repeat_enrollment_v2(p_actor uuid, p_student uuid, p_course uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ declare tipo public.course_type;result uuid;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('enrollment_access') then perform private.raise_cohort_error('MATRICULA_REGLAS_INACTIVAS');end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then perform private.raise_cohort_error('MATRICULA_CUENTA_NO_HABILITADA');end if;
 select c.tipo into tipo from public.courses c where c.id=p_course;
 if not found then perform private.raise_cohort_error('COHORTE_CURSO_NO_ENCONTRADO');end if;
 if not exists(select 1 from public.enrollments where student_id=p_student and course_type=tipo and status='finalizado') then perform private.raise_cohort_error('MATRICULA_REPETICION_ESTADO_INVALIDO');end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then perform private.raise_cohort_error('MATRICULA_EXTENSION_INVALIDA');end if;
 perform set_config('cohortes.repeat_student',p_student::text,true);
 insert into public.enrollments(student_id,course_id,course_type,status,origen,etapa_inscripcion,horas_practica_objetivo)
 values(p_student,p_course,tipo,'pendiente_cohorte','solicitud','por_agendar',(select horas_requeridas from public.courses where id=p_course)) returning id into result;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason)
 values(p_actor,'repeat_enrollment_authorized','enrollment',result::text,jsonb_build_object('studentId',p_student,'courseType',tipo),p_reason);
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION private.reserve_plan_change_v2(p_student uuid, p_enrollment uuid, p_input jsonb, p_actor uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_reassignment boolean DEFAULT false, p_target uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare e public.enrollments;r public.student_schedule_reservations;plan jsonb;slots timestamptz[];t timestamptz;i uuid;target uuid;v_now timestamptz;cfg public.app_settings;expired int;last_expired timestamptz;begin if private.enrollment_rule_enabled('reservations') then perform private.lock_student_schedule_v12(p_student);end if;
 e:=private.assert_change_plan_v2(p_student,p_enrollment,p_actor,p_reassignment);
 if p_reassignment and p_actor is null then perform private.raise_cohort_error('PERMISO_REQUERIDO');end if;
 if p_actor is not null and(p_reason is null or length(btrim(p_reason)) not between 1 and 500) then perform private.raise_cohort_error('PLAN_CAMBIO_MOTIVO_REQUERIDO');end if;
 perform private.expire_reservations_v2(p_student);
 select * into r from public.student_schedule_reservations where student_id=p_student and course_type=e.course_type and estado in ('vigente','pago_en_curso') for update;
 if found then
  if r.replacement_enrollment_id=e.id then return private.reservation_json_v2(r.id);end if;
  perform private.raise_cohort_error('RESERVA_ESTADO_NO_PERMITIDO');end if;
 plan:=private.enrollment_plan_v2(p_input);perform private.assert_enrollment_plan_future(plan,private.cohortes_now());
 select array_agg(value::timestamptz order by value) into slots from jsonb_array_elements_text(plan->'franjas');
 perform private.assert_own_schedule_v12(p_student,slots,p_enrollment);perform 1 from public.cohorts where course_id in(select id from public.courses where tipo=e.course_type) order by id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 v_now:=private.cohortes_now();e:=private.assert_change_plan_v2(p_student,p_enrollment,p_actor,p_reassignment);perform private.assert_enrollment_plan_future(plan,v_now);
 select * into cfg from public.app_settings where id;
 
 select count(*),max(cerrada_at) into expired,last_expired from public.student_schedule_reservations where student_id=p_student and estado='vencida'
 and cerrada_at>=(v_now at time zone 'America/Guayaquil')::date::timestamp at time zone 'America/Guayaquil'
 and cerrada_at<((v_now at time zone 'America/Guayaquil')::date+1)::timestamp at time zone 'America/Guayaquil';
 if expired>=cfg.reservas_expiradas_dia or(expired>=2 and last_expired+make_interval(secs=>cfg.reserva_cooldown_segundos)>v_now) then perform private.raise_cohort_error('RESERVA_LIMITE_EXPIRADAS');end if;
 target:=private.change_plan_candidate_v2(e.id,p_input,p_reassignment,p_target);
 if slots=(select array_agg(scheduled_at order by scheduled_at) from public.practice_slots where student_id=p_student and cohort_id=e.cohort_id and status in('asignado','confirmado')) and(not p_reassignment or target=e.cohort_id) then perform private.raise_cohort_error('PLAN_CAMBIO_SIN_CAMBIOS');end if;
 if exists(select 1 from public.practice_slots s cross join unnest(slots) as proposed(at) where s.student_id=p_student and s.cohort_id<>e.cohort_id
 and s.status in ('asignado','confirmado','completado') and s.scheduled_at<proposed.at+interval '1 hour' and s.scheduled_at+interval '1 hour'>proposed.at)
 or exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations other on other.id=h.reservation_id cross join unnest(slots) as proposed(at)
 where other.student_id=p_student and h.released_at is null and(h.payment_protected or h.expira_at>v_now) and h.scheduled_at<proposed.at+interval '1 hour' and h.scheduled_at+interval '1 hour'>proposed.at) then
 perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO');end if;
 insert into public.student_schedule_reservations(student_id,enrollment_id,cohort_id,course_type,creada_at,expira_at,modalidad,fecha_inicio,horas_por_dia,margen_dias,
 practice_start_date,practice_end_date,precio_snapshot_centavos,precio_snapshot_source,precio_snapshot_at,admission_at,admission_rule_version,
 replacement_enrollment_id,change_requested_by,change_reason,change_is_reassignment,original_plan_snapshot)
 values(p_student,e.id,target,e.course_type,v_now,v_now+make_interval(mins=>cfg.reserva_ttl_minutos),p_input->>'modalidad',(plan->>'fechaInicioEfectiva')::date,(p_input->>'horasPorDia')::int,0,
 (plan->>'fechaInicioEfectiva')::date,(plan->>'ultimaFecha')::date,e.paid_amount_centavos,'payment_snapshot',v_now,v_now,'076',e.id,coalesce(p_actor,p_student),
 coalesce(p_reason,'Cambio de plan solicitado por el alumno'),p_reassignment,to_jsonb(e)||jsonb_build_object('replacementTotalHours',(plan->>'totalHoras')::integer)) returning * into r;
 foreach t in array slots loop
  select id into i from private.change_free_instructors_v2(t,e.id,r.id) limit 1;
  if i is null then perform private.raise_cohort_error('RESERVA_RECURSO_OCUPADO');end if;
  perform 1 from public.users where id=i and rol='instructor' and activo for share;
  if not found then perform private.raise_cohort_error('CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE');end if;
  insert into public.student_schedule_holds(reservation_id,instructor_id,scheduled_at,held_from,expira_at) values(r.id,i,t,v_now,r.expira_at);
 end loop;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
 values(coalesce(p_actor,p_student),'plan_change_reserved','enrollment',e.id::text,jsonb_build_object('practiceStart',e.practice_start_date,'practiceEnd',e.practice_end_date),
 jsonb_build_object('reservationId',r.id,'practiceStart',r.practice_start_date,'practiceEnd',r.practice_end_date),r.change_reason);
 return private.reservation_json_v2(r.id);
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
CREATE OR REPLACE FUNCTION private.integrated_manual_commit_v2(p_id uuid, p_worker uuid, p_student uuid, p_profile jsonb, p_course uuid, p_cohort uuid, p_plan jsonb, p_scheduled_ats timestamp with time zone[], p_instructor uuid, p_documents jsonb, p_payment jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare op public.manual_enrollment_operations; c public.cohorts;
  e public.enrollments; v_type public.course_type; v_slots integer := 0;
  v_response jsonb; v_discount numeric; v_paid numeric; v_net numeric;
  v_birth date; v_senior boolean; v_doc jsonb; v_seen jsonb := '{}'::jsonb;
  v_document_type text; v_status text; v_pending integer; preview jsonb; canonical jsonb; exact_slots timestamptz[];assignment jsonb;
begin if private.enrollment_rule_enabled('reservations') then perform private.lock_student_schedule_v12(p_student);end if;
  select * into op from public.manual_enrollment_operations where id=p_id for update;
  if not found or op.phase <> 'processing' or op.worker_id <> p_worker then
    raise exception 'Operación no reservada por este proceso' using errcode='CD021';
  end if;
  if not exists(select 1 from public.users where id=op.actor_id and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  perform private.require_enrollment_permission(op.actor_id,'reassign_schedules');
  if coalesce((p_payment->>'montoAbonado')::numeric,0)>0 or coalesce((p_payment->>'descuento')::numeric,0)>0 then perform private.require_enrollment_permission(op.actor_id,'view_payments_invoices');end if;
  if p_profile is not null or exists(select 1 from jsonb_array_elements(p_documents) d where d->>'estado'<>'pendiente') then perform private.require_enrollment_permission(op.actor_id,'verify_identity');end if;
  perform set_config('app.enrollment_actor',op.actor_id::text,true);
  perform 1 from public.users where id=p_student for update;
  select tipo into strict v_type from public.courses where id=p_course;
  perform 1 from public.cohorts co join public.courses cu on cu.id=co.course_id where cu.tipo=v_type order by co.id for update of co;
  perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
  preview:=public.manual_plan_preview_v2(op.actor_id,v_type,p_plan,case when p_profile is null then p_student else null end);
  canonical:=preview->'plan';
  select array_agg(value::timestamptz order by value::timestamptz) into exact_slots from jsonb_array_elements_text(canonical->'franjas');
  if p_scheduled_ats is distinct from exact_slots or p_cohort is distinct from (preview->'cohort'->>'id')::uuid or p_course is distinct from (preview->>'courseId')::uuid then perform private.raise_cohort_error('RESERVA_RECURSO_OCUPADO');end if;
  if (p_plan->>'precioCentavos')::bigint is distinct from (preview->>'precioCentavos')::bigint then perform private.raise_cohort_error('PAGO_PRECIO_CAMBIO');end if;
  if not exists(select 1 from jsonb_array_elements(preview->'instructors') i where i->>'id'=p_instructor::text) then perform private.raise_cohort_error('CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE');end if;
  select * into strict c from public.cohorts where id=p_cohort;
  c.precio:=(preview->>'precioCentavos')::numeric/100;

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
    insert into public.users(id,cedula,nombre_completo,telefono,rol,debe_cambiar_password,fecha_nacimiento,identity_document_type,identity_document_number)
    values(p_student,p_profile->>'cedula',p_profile->>'nombreCompleto',nullif(p_profile->>'telefono',''),
      'estudiante',true,(p_profile->>'fechaNacimiento')::date,coalesce(p_profile->>'documentType','cedula'),coalesce(p_profile->>'documentNumber',p_profile->>'cedula'));
  elsif op.student_created then
    raise exception 'Falta perfil de la cuenta nueva' using errcode='CD021';
  end if;
  select fecha_nacimiento into v_birth from public.users where id=p_student;
  v_senior := v_birth is not null and
    date_part('year', age((clock_timestamp() at time zone 'America/Guayaquil')::date, v_birth)) >= 65;

  insert into public.enrollments(student_id,course_id,course_type,cohort_id,status,
    monto_total,descuento,monto_abonado,practice_plan,practice_start_date,practice_end_date,access_end_date,individual_dates_source,individual_dates_guard_ready,paid_amount_centavos,horas_practica_objetivo)
    values(p_student,p_course,v_type,p_cohort,
      case when p_cohort is null then 'pendiente_cohorte'::public.enrollment_status
        else 'activo'::public.enrollment_status end,
      v_net,v_discount,v_paid,p_plan,(canonical->>'fechaInicioEfectiva')::date,(canonical->>'ultimaFecha')::date,(canonical->>'ultimaFecha')::date,'practice_plan',true,(v_paid*100)::bigint,(canonical->>'totalHoras')::integer) returning * into e;
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
    
    update public.enrollment_documents set estado=v_status,
      fecha_marcado=clock_timestamp(),
      marcado_por=op.actor_id
    where enrollment_id=e.id and tipo=v_document_type;
    if not found then raise exception 'Checklist incompleto' using errcode='CD026'; end if;
  end loop;
  if cardinality(p_scheduled_ats)>0 then
    for assignment in select value from jsonb_array_elements(preview->'assignments') loop
      perform 1 from public.users where id=(assignment->>'instructorId')::uuid and rol='instructor' and activo for share;
      if not found then perform private.raise_cohort_error('CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE');end if;
      delete from public.practice_slots where instructor_id=(assignment->>'instructorId')::uuid and student_id is null and status in('disponible','liberado') and scheduled_at=(assignment->>'scheduledAt')::timestamptz;
      insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status) values(p_cohort,(assignment->>'instructorId')::uuid,p_student,(assignment->>'scheduledAt')::timestamptz,60,'asignado');v_slots:=v_slots+1;
    end loop;
  end if;
  insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason) values(op.actor_id,'manual_plan_committed','enrollment',e.id,jsonb_build_object('hours',(canonical->>'totalHoras')::integer,'start',e.practice_start_date,'end',e.practice_end_date,'priceCentavos',preview->'precioCentavos'),'Matrícula manual con plan canónico y caja existente');
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
end $function$
;

create function public.manual_plan_calendar_v13(p_actor uuid,p_type public.course_type,p_month date,p_mode text,p_hours integer) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare d date;h integer;ok boolean;r jsonb;hours jsonb;days jsonb:='[]';plan jsonb;begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');
 if p_month is null or not isfinite(p_month) or p_month<>date_trunc('month',p_month)::date then perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 perform private.enrollment_plan_v2(jsonb_build_object('modalidad',p_mode,'horasPorDia',p_hours,'fechaInicio',p_month,'horaInicio',6));
 for d in select generate_series(p_month,p_month+interval '1 month'-interval '1 day',interval '1 day')::date loop
  ok:=false;hours:='[]';plan:=private.enrollment_plan_v2(jsonb_build_object('modalidad',p_mode,'horasPorDia',p_hours,'fechaInicio',d,'horaInicio',6));
  if d>=(private.cohortes_now() at time zone 'America/Guayaquil')::date and ((extract(isodow from d) in(6,7))=(p_mode='fin_de_semana')) then
   for h in 6..coalesce((select practicas_hora_fin from public.app_settings where id),22)-p_hours loop
    begin
     r:=public.manual_plan_preview_v2(p_actor,p_type,jsonb_build_object('modalidad',p_mode,'horasPorDia',p_hours,'fechaInicio',d,'horaInicio',h));
     ok:=true;hours:=hours||jsonb_build_array(jsonb_build_object('hora',lpad(h::text,2,'0')||':00','factible',true,'diasFallan','[]'::jsonb,'motivo',null));
    exception when sqlstate 'P7000' then
     if sqlerrm not in('RESERVA_SIN_HORARIOS','RESERVA_RECURSO_OCUPADO','PLAN_FRANJA_PASADA','PLAN_INICIO_PASADO') then raise;end if;
     hours:=hours||jsonb_build_array(jsonb_build_object('hora',lpad(h::text,2,'0')||':00','factible',false,'diasFallan','[]'::jsonb,'motivo',jsonb_build_object('mensaje','No hay disponibilidad para el plan completo.')));
    end;
   end loop;
  end if;
  days:=days||jsonb_build_array(jsonb_build_object('fecha',d,'disponible',ok,'motivo',case when not ok then 'No hay disponibilidad para el plan completo en esta fecha y modalidad.' end,'planDays',plan->'dias','horas',hours));
 end loop;
 return jsonb_build_object('serverNow',private.cohortes_now(),'dias',days);
end $$;
revoke all on function public.manual_plan_calendar_v13(uuid,public.course_type,date,text,integer) from public,anon,authenticated;
grant execute on function public.manual_plan_calendar_v13(uuid,public.course_type,date,text,integer) to service_role;

commit;
