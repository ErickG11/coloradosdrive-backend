-- Incluye cierre L11 aprobado como fuente explícita; no aplicar aparte.
-- L11: aplicar MANUALMENTE después de 080. No usa ni modifica 064.
-- Expansión compatible; activación independiente y apagada por defecto.
begin;
set local lock_timeout='5s';
-- Copias inmutables de funciones para rollback funcional, sin borrar evidencia.
do $$declare r record;begin
 for r in select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in('commit_manual_enrollment','update_manual_enrollment_details','student_schedule_calendar_v2') loop
 if not exists(select 1 from pg_proc b join pg_namespace bn on bn.oid=b.pronamespace where bn.nspname='public' and b.proname='legacyL11_'||r.proname) then
 execute format('alter function public.%I(%s) rename to %I',r.proname,r.args,'legacyL11_'||r.proname);end if;end loop;end $$;
create or replace function public.assert_enrollment_permission_v2(p_actor uuid,p_permission text) returns void language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('permissions') then perform private.require_enrollment_permission(p_actor,p_permission);end if;end $$;

create or replace function public.manual_plan_preview_v2(p_actor uuid,p_type public.course_type,p_input jsonb,p_student uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare plan jsonb;slots timestamptz[];c public.cohorts;price bigint;instructors jsonb;assignments jsonb:='[]';t timestamptz;chosen uuid;chosen_name text;previous uuid;begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');
 if not private.enrollment_rule_enabled('date_rules') then perform private.raise_cohort_error('RESERVA_REGLAS_INACTIVAS');end if;
 if p_student is not null and not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo and identity_access_blocked_at is null) then perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 plan:=private.enrollment_plan_v2(p_input);perform private.assert_enrollment_plan_future(plan,private.cohortes_now());
 if not exists(select 1 from public.enrollment_plan_options where modalidad=p_input->>'modalidad' and horas_por_dia=(p_input->>'horasPorDia')::integer and habilitada) then perform private.raise_cohort_error('PLAN_OPCION_NO_OFERTADA');end if;
 select array_agg(value::timestamptz order by value::timestamptz) into slots from jsonb_array_elements_text(plan->'franjas');
 if exists(select 1 from public.practice_slots s cross join unnest(slots) t where s.student_id=p_student and s.status in('asignado','confirmado','completado') and abs(extract(epoch from(s.scheduled_at-t)))<3600)
 or exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations r on r.id=h.reservation_id cross join unnest(slots) t where r.student_id=p_student and h.released_at is null and(h.payment_protected or h.expira_at>private.cohortes_now()) and abs(extract(epoch from(h.scheduled_at-t)))<3600) then perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO');end if;
 select co.* into c from public.cohorts co join public.courses cu on cu.id=co.course_id where cu.tipo=p_type and co.habilitada and co.cancelled_at is null
 and (private.cohort_calendar_v2(co.fecha_inicio_matricula,co.fecha_fin_matricula,co.fecha_inicio_curso,co.fecha_fin_curso,co.habilitada,private.cohortes_now())->>'open')::boolean
 and (plan->>'fechaInicioEfectiva')::date>=co.fecha_inicio_curso and (plan->>'ultimaFecha')::date<=co.fecha_fin_curso
 and private.cohort_peak_v2(co.id,(plan->>'fechaInicioEfectiva')::date,(plan->>'ultimaFecha')::date)<co.cupo_maximo
 order by co.fecha_fin_curso,co.id limit 1;
 if c.id is null then perform private.raise_cohort_error('RESERVA_SIN_HORARIOS');end if;
 select precio_centavos into price from public.course_type_prices where tipo=p_type;
 if price is null then perform private.raise_cohort_error('PAGO_PRECIO_NO_CONFIGURADO');end if;
 foreach t in array slots loop
  select i.id,i.nombre_completo into chosen,chosen_name from private.free_instructors_v2(array[t],p_student) with ordinality i(id,nombre_completo,ord) order by(i.id=previous) desc nulls last,i.ord limit 1;
  if chosen is null then perform private.raise_cohort_error('RESERVA_RECURSO_OCUPADO');end if;
  assignments:=assignments||jsonb_build_array(jsonb_build_object('scheduledAt',t,'instructorId',chosen,'nombreCompleto',chosen_name));previous:=chosen;
 end loop;
 instructors:=jsonb_build_array(jsonb_build_object('id',assignments->0->'instructorId','nombreCompleto',assignments->0->'nombreCompleto'));
 return jsonb_build_object('plan',plan,'cohort',to_jsonb(c)||jsonb_build_object('precio',price/100.0),'courseId',c.course_id,'precioCentavos',price,'instructors',instructors,'assignments',assignments,'serverNow',private.cohortes_now());
end $$;
create or replace function private.integrated_manual_commit_v2(
  p_id uuid, p_worker uuid, p_student uuid, p_profile jsonb, p_course uuid,
  p_cohort uuid, p_plan jsonb, p_scheduled_ats timestamptz[], p_instructor uuid,
  p_documents jsonb, p_payment jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare op public.manual_enrollment_operations; c public.cohorts;
  e public.enrollments; v_type public.course_type; v_slots integer := 0;
  v_response jsonb; v_discount numeric; v_paid numeric; v_net numeric;
  v_birth date; v_senior boolean; v_doc jsonb; v_seen jsonb := '{}'::jsonb;
  v_document_type text; v_status text; v_pending integer; preview jsonb; canonical jsonb; exact_slots timestamptz[];assignment jsonb;
begin
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
      v_net,v_discount,v_paid,p_plan,(canonical->>'fechaInicioEfectiva')::date,(canonical->>'ultimaFecha')::date,(canonical->>'ultimaFecha')::date,'practice_plan',true,(v_paid*100)::bigint,15) returning * into e;
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
    for assignment in select value from jsonb_array_elements(preview->'assignments') loop
      perform 1 from public.users where id=(assignment->>'instructorId')::uuid and rol='instructor' and activo for share;
      if not found then perform private.raise_cohort_error('CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE');end if;
      delete from public.practice_slots where instructor_id=(assignment->>'instructorId')::uuid and student_id is null and status in('disponible','liberado') and scheduled_at=(assignment->>'scheduledAt')::timestamptz;
      insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status) values(p_cohort,(assignment->>'instructorId')::uuid,p_student,(assignment->>'scheduledAt')::timestamptz,60,'asignado');v_slots:=v_slots+1;
    end loop;
  end if;
  insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason) values(op.actor_id,'manual_plan_committed','enrollment',e.id,jsonb_build_object('hours',15,'start',e.practice_start_date,'end',e.practice_end_date,'priceCentavos',preview->'precioCentavos'),'Matrícula manual con plan canónico y caja existente');
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

create or replace function public.commit_manual_enrollment(p_id uuid,p_worker uuid,p_student uuid,p_profile jsonb,p_course uuid,p_cohort uuid,p_plan jsonb,p_scheduled_ats timestamptz[],p_instructor uuid,p_documents jsonb,p_payment jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare actor uuid;begin
 if private.enrollment_rule_enabled('permissions') then
  select actor_id into actor from public.manual_enrollment_operations where id=p_id and worker_id=p_worker and phase='processing';
  if actor is not null then perform set_config('app.enrollment_actor',actor::text,true);end if;
  perform private.require_enrollment_permission(actor,'reassign_schedules');
  if coalesce((p_payment->>'montoAbonado')::numeric,0)>0 or coalesce((p_payment->>'descuento')::numeric,0)>0 then perform private.require_enrollment_permission(actor,'view_payments_invoices');end if;
  if p_profile is not null or exists(select 1 from jsonb_array_elements(p_documents) d where d->>'estado'<>'pendiente') then perform private.require_enrollment_permission(actor,'verify_identity');end if;
 end if;
 if private.enrollment_rule_enabled('date_rules') then return private.integrated_manual_commit_v2(p_id,p_worker,p_student,p_profile,p_course,p_cohort,p_plan,p_scheduled_ats,p_instructor,p_documents,p_payment);end if;
 return public."legacyL11_commit_manual_enrollment"(p_id,p_worker,p_student,p_profile,p_course,p_cohort,p_plan,p_scheduled_ats,p_instructor,p_documents,p_payment);end $$;
create or replace function private.reserve_schedule_v2(p_student uuid,p_enrollment uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.enrollments;c public.cohorts;r public.student_schedule_reservations;
 plan jsonb;slots timestamptz[];t timestamptz;i uuid;v_now timestamptz;v_end timestamptz;
 cfg public.app_settings;price bigint;v_start date;v_last date;v_count int;v_last_expired timestamptz;
begin
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
 v_start:=(plan->>'fechaInicioEfectiva')::date;v_last:=(plan->>'ultimaFecha')::date;
 -- Bloquear candidatas en orden estable; elegir después por fin e id.
 perform 1 from public.cohorts co join public.courses cu on cu.id=co.course_id where cu.tipo=e.course_type order by co.id for update of co;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 v_now:=private.cohortes_now();perform private.assert_enrollment_plan_future(plan,v_now);
 select * into cfg from public.app_settings where id;
 if cfg.vehiculos_disponibles is null then perform private.raise_cohort_error('CAPACIDAD_CONFIG_REQUERIDA');end if;
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
 if exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations rr on rr.id=h.reservation_id cross join unnest(slots) t where rr.student_id=p_student and h.released_at is null and(h.payment_protected or h.expira_at>private.cohortes_now()) and abs(extract(epoch from(h.scheduled_at-t)))<3600) then perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO');end if;
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
   individual_dates_source='reservation_holds',horas_practica_objetivo=15 where id=e.id;
 insert into public.student_schedule_events(reservation_id,accion) values(r.id,'reservada');
 return private.reservation_json_v2(r.id);
end $$;
create or replace function public.student_schedule_calendar_v2(p_student uuid,p_enrollment uuid,p_month date,p_mode text,p_hours integer)
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare d date;h integer;ok boolean;rows jsonb:='[]';state jsonb;begin
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_mode not in ('entre_semana','fin_de_semana') or p_hours not between 1 and 6
 or p_month<date_trunc('month',private.cohortes_now() at time zone 'America/Guayaquil')::date
 then
 perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 -- Autorizar incluso los meses sin días factibles.
 if not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo) then perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 if not exists(select 1 from public.enrollments where id=p_enrollment and student_id=p_student) then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 perform private.expire_reservations_v2(p_student);
 for d in select generate_series(p_month,p_month+interval '1 month'-interval '1 day',interval '1 day')::date loop
  ok:=false;
  if d>=(private.cohortes_now() at time zone 'America/Guayaquil')::date
    and ((extract(isodow from d) in (6,7))=(p_mode='fin_de_semana')) then
   for h in 6..22-p_hours loop
    begin
     state:=public.student_schedule_preview_v2(p_student,p_enrollment,jsonb_build_object('fechaInicio',d,'modalidad',p_mode,'horasPorDia',p_hours,'horaInicio',h));
     if (state->>'factible')::boolean then ok:=true;exit;end if;
    exception when sqlstate 'P7000' then
     if sqlerrm not in ('PLAN_FRANJA_PASADA','PLAN_INICIO_PASADO') then raise;end if;
    end;
   end loop;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('fecha',d,'disponible',ok));
 end loop;
 return jsonb_build_object('serverNow',private.cohortes_now(),'dias',rows,'calendarEndDate',(select max(c.fecha_fin_curso) from public.cohorts c join public.courses cu on cu.id=c.course_id join public.enrollments e on e.course_type=cu.tipo where e.id=p_enrollment and c.habilitada and c.cancelled_at is null and c.fecha_inicio_matricula<=c.fecha_fin_matricula and c.fecha_fin_matricula<=c.fecha_fin_curso and private.cohortes_now()>=c.fecha_inicio_matricula::timestamp at time zone 'America/Guayaquil' and private.cohortes_now()<(c.fecha_fin_matricula-4)::timestamp at time zone 'America/Guayaquil'));
end $$;
create or replace function private.integrated_manual_details_v2(
  p_enrollment uuid, p_actor uuid, p_documents jsonb, p_payment jsonb
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare e public.enrollments; v_price numeric; v_discount numeric; v_paid numeric;
  v_net numeric; v_birth date; v_senior boolean; v_doc jsonb;
  v_seen jsonb := '{}'::jsonb; v_type text; v_status text;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  if p_payment is not null then perform private.require_enrollment_permission(p_actor,'view_payments_invoices');end if;
  if p_documents is not null then perform private.require_enrollment_permission(p_actor,'verify_identity');end if;
  perform set_config('app.enrollment_actor',p_actor::text,true);
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
      select coalesce((e.practice_plan->>'precioCentavos')::numeric/100,e.monto_total+e.descuento,precio) into v_price from public.cohorts where id=e.cohort_id for update;
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
    if private.enrollment_rule_enabled('billing') and v_paid<e.monto_abonado then perform private.raise_cohort_error('FACTURA_DEVOLUCION_DOCUMENTADA');end if;
    update public.enrollments set monto_total=v_net,descuento=v_discount,monto_abonado=v_paid,paid_amount_centavos=(v_paid*100)::bigint
      where id=p_enrollment;
    insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason) values(p_actor,'manual_cash_updated','enrollment',p_enrollment,jsonb_build_object('total',e.monto_total,'paid',e.monto_abonado,'discount',e.descuento),jsonb_build_object('total',v_net,'paid',v_paid,'discount',v_discount),'Actualización de caja existente, sin operación de proveedor');
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

create or replace function public.update_manual_enrollment_details(p_enrollment uuid,p_actor uuid,p_documents jsonb,p_payment jsonb) returns boolean language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('date_rules') or private.enrollment_rule_enabled('permissions') then return private.integrated_manual_details_v2(p_enrollment,p_actor,p_documents,p_payment);end if;
 return public."legacyL11_update_manual_enrollment_details"(p_enrollment,p_actor,p_documents,p_payment);end $$;
-- Cada abono nuevo es un pago de caja real y una factura; no se migra saldo histórico.
drop index public.payments_one_approved;
create unique index payments_one_approved on public.payments(enrollment_id) where estado='aprobado' and reservation_id is not null;
create or replace function private.cash_invoice_v2() returns trigger language plpgsql security invoker set search_path='' as $$declare delta bigint;actor uuid;begin
 if not private.enrollment_rule_enabled('billing') or new.origen='solicitud' then return new;end if;
 delta:=((new.monto_abonado-case when tg_op='INSERT' then 0 else old.monto_abonado end)*100)::bigint;
 if delta<=0 then return new;end if;
 actor:=nullif(current_setting('app.enrollment_actor',true),'')::uuid;
 if actor is null then select actor_id into actor from public.manual_enrollment_operations where student_id=new.student_id and phase='processing' order by updated_at desc limit 1;end if;
 perform private.require_enrollment_permission(actor,'view_payments_invoices');
 insert into public.payments(student_id,enrollment_id,attempt_key,proveedor,estado,subtotal_centavos,recargo_centavos,total_centavos,recibido_centavos,recibido_moneda,actor_id,confirmed_at)
 values(new.student_id,new.id,gen_random_uuid(),'manual','aprobado',delta,0,delta,delta,'USD',actor,private.cohortes_now());
 return new;end $$;
drop trigger if exists enrollments_cash_invoice on public.enrollments;
create trigger enrollments_cash_invoice after insert or update of monto_abonado on public.enrollments for each row execute function private.cash_invoice_v2();
-- Control de agenda propia en cualquier escritura, incluido otro tipo de curso.
create or replace function private.student_slot_guard_l11() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if not private.enrollment_rule_enabled('capacity') or new.student_id is null or new.status not in('asignado','confirmado','completado') then return new;end if;
 perform 1 from public.users where id=new.student_id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 if exists(select 1 from public.users where id=new.student_id and identity_access_blocked_at is not null) then perform private.raise_cohort_error('SOLICITUD_ACCESO_REVOCADO');end if;
 if exists(select 1 from public.practice_slots s where s.id is distinct from new.id and s.student_id=new.student_id and s.status in('asignado','confirmado','completado') and abs(extract(epoch from(s.scheduled_at-new.scheduled_at)))<3600) then perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO');end if;
 return new;end $$;
drop trigger if exists practice_slots_00_student on public.practice_slots;
create trigger practice_slots_00_student before insert or update of student_id,scheduled_at,status on public.practice_slots for each row execute function private.student_slot_guard_l11();

-- Permisos también en RPC heredadas; conservar firmas y valores por defecto.
do $wrap$declare r record;permission text;call_args text;result_sql text;backup text;guard_sql text;begin
 for r in select p.*,pg_get_function_arguments(p.oid) args,pg_get_function_identity_arguments(p.oid) identity_args,pg_get_function_result(p.oid) result_type from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(
 'reserve_manual_enrollment','find_manual_students','find_manual_students_v2','save_student_profile','set_student_active','restore_student_practice','assign_pending_enrollment_cohort',
 'admin_release_student_reservation','confirmar_identidad_presencial_admin','registrar_verificacion_inscripcion','revisar_documento_solicitud','reclamar_aprobacion_inscripcion','finalizar_aprobacion_inscripcion','finalizar_aprobacion_solicitud','rechazar_solicitud_inscripcion','devolver_solicitud_inscripcion','begin_student_payment','begin_student_deletion','delete_student_data') and 'p_actor'=any(p.proargnames) loop
 permission:=case when r.proname='begin_student_payment' then 'view_payments_invoices' when r.proname='admin_release_student_reservation' or r.proname in('assign_pending_enrollment_cohort','restore_student_practice','reserve_manual_enrollment','find_manual_students','find_manual_students_v2') then 'reassign_schedules' else 'verify_identity' end;
 backup:='legacyL11_'||r.proname;
 if not exists(select 1 from pg_proc b join pg_namespace bn on bn.oid=b.pronamespace where bn.nspname='public' and b.proname=backup) then
 execute format('alter function public.%I(%s) rename to %I',r.proname,r.identity_args,backup);end if;
 select string_agg(quote_ident(arg),',' order by i) into call_args from unnest(r.proargnames[1:r.pronargs]) with ordinality a(arg,i);
 guard_sql:=format('perform public.assert_enrollment_permission_v2(p_actor,%L);',permission);if r.proname='begin_student_payment' then guard_sql:='if p_proveedor=''manual'' then '||guard_sql||'end if;';end if;
 result_sql:=case when r.proretset then 'return query select * from ' when r.result_type='void' then 'perform ' else 'return ' end;
 execute format('create or replace function public.%I(%s) returns %s language plpgsql security invoker set search_path=pg_catalog as $body$begin %s %s public.%I(%s);end $body$',r.proname,r.args,r.result_type,guard_sql,result_sql,backup,call_args);
 end loop;end $wrap$;
-- No mutación silenciosa de la configuración: validar dependencias en el commit de activación.
create or replace function private.activation_l11() returns trigger language plpgsql security invoker set search_path='' as $$declare pair record;begin
 for pair in select * from(values('capacity','date_rules'),('date_rules','reservations'),('date_rules','permissions'),('reservations','prices'),('reservations','date_rules'),('reservations','capacity'),('reservations','payments'),('reservations','enrollment_access'),('payments','reservations'),('cohort_admin','date_rules'),('cohort_admin','permissions'),('schedule_changes','reservations'),('schedule_changes','permissions'),('billing','permissions'),('identity','permissions'),('foreign_identity','identity'),('waitlist','reservations')) v(k,dep) loop
 if private.enrollment_rule_enabled(pair.k) and not private.enrollment_rule_enabled(pair.dep) then perform private.raise_cohort_error('CONFIG_DEPENDENCIA_REQUERIDA');end if;end loop;
 if private.enrollment_rule_enabled('reservations') and ((select count(*) from public.course_type_prices)<>2 or not exists(select 1 from public.app_settings where id and vehiculos_disponibles is not null)) then perform private.raise_cohort_error('CAPACIDAD_CONFIG_REQUERIDA');end if;
 return new;end $$;
drop trigger if exists enrollment_activation_l11 on public.enrollment_rule_flags;
create constraint trigger enrollment_activation_l11 after insert or update on public.enrollment_rule_flags deferrable initially deferred for each row execute function private.activation_l11();

-- Embudo: solo hechos posteriores a la activación; sin datos personales.
create or replace function private.funnel_l11() returns trigger language plpgsql security invoker set search_path='' as $$declare ev text;enrollment uuid;key text;begin
 if not private.enrollment_rule_enabled('metrics') then return new;end if;
 if tg_table_name='solicitudes_inscripcion' then
  if tg_op='INSERT' then ev:='registered';elsif new.estado='archivada' and old.estado is distinct from new.estado then ev:='verified';else return new;end if;
  enrollment:=new.linked_enrollment_id;key:='request:'||new.id||':'||ev;
 elsif tg_table_name='student_schedule_reservations' then
  if tg_op='INSERT' then ev:='reserved';elsif new.estado='vencida' and old.estado is distinct from new.estado then ev:='expired';else return new;end if;
  if new.replacement_enrollment_id is not null then return new;end if;
  enrollment:=new.enrollment_id;key:='reservation:'||new.id||':'||ev;
 else
  if new.estado<>'aprobado' or new.enrollment_id is null then return new;end if;ev:='paid';enrollment:=new.enrollment_id;key:='enrollment:'||enrollment||':paid';
 end if;
 insert into public.enrollment_funnel_events(enrollment_id,event,dedup_key) values(enrollment,ev,key) on conflict(dedup_key) do nothing;return new;end $$;
drop trigger if exists request_funnel_l11 on public.solicitudes_inscripcion;
create trigger request_funnel_l11 after insert or update of estado on public.solicitudes_inscripcion for each row execute function private.funnel_l11();
drop trigger if exists reservation_funnel_l11 on public.student_schedule_reservations;
create trigger reservation_funnel_l11 after insert or update of estado on public.student_schedule_reservations for each row execute function private.funnel_l11();
drop trigger if exists payment_funnel_l11 on public.payments;
create trigger payment_funnel_l11 after insert or update of estado on public.payments for each row execute function private.funnel_l11();
create or replace function public.record_schedule_choice_v2(p_student uuid,p_enrollment uuid) returns void language plpgsql security invoker set search_path='' as $$begin
 if not exists(select 1 from public.enrollments where id=p_enrollment and student_id=p_student) then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 if private.enrollment_rule_enabled('metrics') then insert into public.enrollment_funnel_events(enrollment_id,event,dedup_key) values(p_enrollment,'schedule_chosen','enrollment:'||p_enrollment||':chosen') on conflict(dedup_key) do nothing;end if;end $$;
create or replace function public.enrollment_metrics_v2(p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('metrics') then return jsonb_build_object('active',false);end if;
 return jsonb_build_object('active',true,'serverNow',private.cohortes_now(),'counts',(select coalesce(jsonb_object_agg(event,n),'{}') from (select event,count(*) n from public.enrollment_funnel_events where event<>'paid' or exists(select 1 from public.enrollment_admin_permissions where admin_id=p_actor and permission='view_payments_invoices' and revoked_at is null) group by event) x));end $$;
create or replace function private.legacy079_enrollment_has_access_v2(p_enrollment uuid) returns boolean language sql volatile security invoker set search_path='' as $$
 select coalesce((select e.status in('activo','finalizado') and e.etapa_inscripcion='activa' and(not e.individual_dates_guard_ready or(e.practice_start_date is not null and e.access_end_date is not null and e.monto_total is not null and e.paid_amount_centavos>=round(e.monto_total*100)::bigint and private.cohortes_now()>=e.practice_start_date::timestamp at time zone 'America/Guayaquil' and private.cohortes_now()<(e.access_end_date+1)::timestamp at time zone 'America/Guayaquil')) from public.enrollments e where e.id=p_enrollment),false) $$;
-- Observación sobre configuración/notificaciones existentes, sin tablas de trabajos o alertas.
alter table public.app_settings add column if not exists cohort_job_heartbeats jsonb not null default '{}',
 add column if not exists cohort_metrics_activated_at timestamptz,
 add column if not exists cohort_cron_disabled_production boolean not null default false;
create or replace function private.metrics_activation_l11() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.key='metrics' and new.enabled and not old.enabled then update public.app_settings set cohort_metrics_activated_at=private.cohortes_now() where id;end if;return new;end $$;
drop trigger if exists metrics_activation_l11 on public.enrollment_rule_flags;
create trigger metrics_activation_l11 after update on public.enrollment_rule_flags for each row execute function private.metrics_activation_l11();
create or replace function public.enrollment_job_heartbeat_v2(p_job text,p_result text,p_disabled boolean default false) returns void language plpgsql security invoker set search_path='' as $$begin
 if p_job='startup' then update public.app_settings set cohort_cron_disabled_production=p_disabled where id;end if;
 if not private.enrollment_rule_enabled('metrics') then return;end if;
 if p_job not in('practice','expiry','payment_welcome','reconciliation','billing','request_email','approval_recovery','cleanup','monitor','startup') or p_result not in('started','ok','failed') then perform private.raise_cohort_error('CONFIG_OBSERVACION_INVALIDA');end if;
 update public.app_settings set cohort_job_heartbeats=jsonb_set(cohort_job_heartbeats,array[p_job],coalesce(cohort_job_heartbeats->p_job,'{}')||jsonb_build_object(p_result,private.cohortes_now(),'lastResult',p_result)),cohort_cron_disabled_production=case when p_job='startup' then p_disabled else cohort_cron_disabled_production end where id;
end $$;
create or replace function private.domain_alert_l11(p_code text,p_entity uuid,p_permission text,p_message text,p_severity text default 'alta') returns void language plpgsql security invoker set search_path='' as $$begin
 insert into public.notifications(user_id,tipo,titulo,mensaje,domain_code,domain_entity_id,domain_severity,domain_last_seen_at)
 select u.id,'cambio_realizado',p_code,p_message,p_code,p_entity,p_severity,private.cohortes_now() from public.users u join public.enrollment_admin_permissions a on a.admin_id=u.id and a.permission=p_permission and a.revoked_at is null where u.rol='admin' and u.activo
 on conflict(user_id,domain_code,domain_entity_id) where domain_code is not null and domain_resolved_at is null do update set domain_last_seen_at=excluded.domain_last_seen_at,
 read_at=case when public.notifications.domain_last_seen_at<private.cohortes_now()-interval '1 day' then null else public.notifications.read_at end;
end $$;
create or replace view private.cohort_alert_causes_l11 with(security_invoker=true) as
select 'PAGO_DESPACHADO_INCIERTO'::text code,p.id entity,'view_payments_invoices'::text permission,'Pago despachado sin respuesta definitiva. Consultar al proveedor; no liberar ni repetir el cobro.'::text message from public.payments p where p.estado='pendiente' and p.dispatch_at<private.cohortes_now()-interval '15 minutes'
union all select 'PAGO_APROBADO_SIN_RECURSOS',id,'view_payments_invoices','Pago en revisión. Resolver matrícula/recursos o documentar devolución, sin simular al proveedor.' from public.payments where estado='revision'
union all select 'PAGO_CONCILIACION_NO_OPERATIVA',id,'view_payments_invoices','Consulta de Kushki no disponible. Revisar el proveedor; conciliación automática pendiente.' from public.payments where estado='pendiente' and proveedor='kushki' and dispatch_at is not null
union all select 'PAGO_COBRO_SIN_MATRICULA',p.id,'view_payments_invoices','Pago aprobado sin matrícula relacionada. Revisar la asociación y evidencia del cobro.' from public.payments p left join public.enrollments e on e.id=p.enrollment_id where p.estado='aprobado' and e.id is null
union all select 'PAGO_IMPORTE_INCONSISTENTE',id,'view_payments_invoices','El importe o moneda recibidos no coinciden con el pago. Revisar antes de asignar recursos.' from public.payments where recibido_centavos is not null and(recibido_centavos<>total_centavos or recibido_moneda is distinct from moneda)
union all select 'FACTURA_PENDIENTE',id,'view_payments_invoices','Pagado, factura pendiente. Completar la emisión autorizada o reintentar la misma factura.' from public.billing_documents where state='manual_pending' or(state='failed' and attempts>=(select billing_retry_alert_after from public.app_settings where id))
union all select 'CORREO_OUTBOX_ATASCADO',id,'manage_cohorts_prices','Correo sin entregar. Revisar configuración y reintentar sin crear otro evento.' from public.notifications where domain_code is null and(email_status='fallido' or(email_status='pendiente' and email_next_attempt_at<private.cohortes_now()-interval '15 minutes')) and email_last_error is distinct from 'ESPERA_RETIRO_SOLICITADO'
union all select 'SOLICITUD_CORREO_ATASCADO',id,'verify_identity','Cambio de estado sin correo entregado. Reintentar desde la solicitud, sin reproducir contenido.' from public.solicitud_auditoria where email_state='failed' or(email_state='queued' and email_next_at<private.cohortes_now()-interval '15 minutes') or(email_state='processing' and email_lease_until<private.cohortes_now()-interval '5 minutes')
union all select 'PAGO_CORREO_ATASCADO',payment_id,'view_payments_invoices','Acuse de pago sin entregar. Recuperar el outbox existente, sin repetir el cobro.' from public.payment_mail_outbox where estado='fallido' or(estado='enviando' and lease_until<private.cohortes_now()-interval '5 minutes') or(estado='pendiente' and next_attempt_at<private.cohortes_now()-interval '15 minutes')
union all select 'RESERVA_VENCIDA_SIN_LIBERAR',id,'reassign_schedules','Reserva vencida sin limpiar. Revisar el trabajo de caducidad; conservar pagos en proceso.' from public.student_schedule_reservations where estado='vigente' and expira_at<private.cohortes_now()-interval '5 minutes'
union all select 'CAPACIDAD_VEHICULOS_EXCEDIDA',s.id,'manage_cohorts_prices','Hora sobre el límite global de vehículos. Reasignar de forma auditada; no cancelar automáticamente.' from public.practice_slots s where s.student_id is not null and s.status in('asignado','confirmado') and s.scheduled_at>private.cohortes_now() and private.vehicle_occupation_v2(s.scheduled_at)>coalesce((select vehiculos_disponibles from public.app_settings where id),2147483647)
union all select 'CAPACIDAD_INSTRUCTOR_INVALIDO',s.id,'reassign_schedules','Práctica futura con instructor inactivo o inválido. Revisar y reasignar antes de la clase.' from public.practice_slots s left join public.users u on u.id=s.instructor_id where s.student_id is not null and s.status in('asignado','confirmado') and s.scheduled_at>private.cohortes_now() and(u.id is null or u.rol<>'instructor' or not u.activo)
union all select 'BACKFILL_DECISION_PENDIENTE',e.id,'manage_cohorts_prices','Fechas históricas sin evidencia aprobada. Exportar preflight y aprobar excepción auditada; no activar el guard de este caso.' from public.enrollments e where e.status='activo' and not e.individual_dates_guard_ready
union all select 'CRON_DESACTIVADO_PRODUCCION','00000000-0000-0000-0000-000000000000'::uuid,'manage_cohorts_prices','DISABLE_CRON activo en producción. Restablecer los trabajos y verificar sus latidos.' from public.app_settings where id and cohort_cron_disabled_production
union all select 'TRABAJO_SIN_LATIDO',md5(j.job)::uuid,'manage_cohorts_prices','Trabajo '||j.job||' sin éxito reciente. Revisar ejecución, error técnico y recuperar la cola sin duplicar.' from public.app_settings a cross join(values('practice',5),('expiry',5),('payment_welcome',5),('reconciliation',35),('billing',15),('request_email',5),('approval_recovery',15),('cleanup',1560),('monitor',15)) j(job,minutes)
where a.id and a.cohort_metrics_activated_at<private.cohortes_now()-make_interval(mins=>j.minutes) and coalesce((a.cohort_job_heartbeats->j.job->>'ok')::timestamptz,a.cohort_metrics_activated_at)<private.cohortes_now()-make_interval(mins=>j.minutes);
create or replace function public.monitor_enrollment_rules_v2() returns integer language plpgsql security invoker set search_path='' as $$declare c record;n integer:=0;begin
 if not private.enrollment_rule_enabled('metrics') then return 0;end if;
 perform pg_advisory_xact_lock(hashtextextended('cohort_monitor_l11',0));
 for c in select * from private.cohort_alert_causes_l11 loop perform private.domain_alert_l11(c.code,c.entity,c.permission,c.message);n:=n+1;end loop;
 update public.notifications n set domain_resolved_at=private.cohortes_now() where domain_resolved_at is null and domain_code in('PAGO_DESPACHADO_INCIERTO','PAGO_APROBADO_SIN_RECURSOS','PAGO_CONCILIACION_NO_OPERATIVA','PAGO_COBRO_SIN_MATRICULA','PAGO_IMPORTE_INCONSISTENTE','FACTURA_PENDIENTE','CORREO_OUTBOX_ATASCADO','SOLICITUD_CORREO_ATASCADO','PAGO_CORREO_ATASCADO','RESERVA_VENCIDA_SIN_LIBERAR','CAPACIDAD_VEHICULOS_EXCEDIDA','CAPACIDAD_INSTRUCTOR_INVALIDO','BACKFILL_DECISION_PENDIENTE','CRON_DESACTIVADO_PRODUCCION','TRABAJO_SIN_LATIDO') and not exists(select 1 from private.cohort_alert_causes_l11 c where c.code=n.domain_code and c.entity=n.domain_entity_id);
 update public.notifications set domain_resolved_at=private.cohortes_now() where domain_code='SEGURIDAD_OPERACION_RECHAZADA' and domain_resolved_at is null and domain_last_seen_at<private.cohortes_now()-interval '24 hours';return n;end $$;
create or replace function public.report_enrollment_security_v2(p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$begin
 if not private.enrollment_rule_enabled('metrics') then return;end if;
 perform private.domain_alert_l11('SEGURIDAD_OPERACION_RECHAZADA',p_actor,'manage_cohorts_prices','Operación rechazada por permiso o pertenencia. Revisar el código y correlación del registro; no conceder acceso automáticamente.');end $$;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.set_course_type_price_v2(uuid,public.course_type,bigint,text)'::regprocedure);execute replace(definition,'not between 0 and 999999 or','not between 0 and 999999999 or');
 definition:=pg_get_functiondef('public.set_vehicle_capacity_v2(uuid,integer,text)'::regprocedure);execute replace(definition,'not between 0 and 1000 or','<0 or');
end $$;
create or replace function public.student_schedule_preview_v2(p_student uuid,p_enrollment uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.enrollments;c public.cohorts;plan jsonb;slots timestamptz[];t timestamptz;
 free boolean;all_free boolean:=true;days jsonb:='[]';d jsonb;bad jsonb:='[]';cfg public.app_settings;
begin
 if not private.enrollment_rule_enabled('reservations') then perform private.raise_cohort_error('RESERVA_REGLAS_INACTIVAS');end if;
 if not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo and identity_access_blocked_at is null) then
  perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student;
 if not found then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 plan:=private.enrollment_plan_v2(p_input);perform private.assert_enrollment_plan_future(plan,private.cohortes_now());
 select array_agg(value::timestamptz order by value::timestamptz) into slots from jsonb_array_elements_text(plan->'franjas');
 select * into cfg from public.app_settings where id;
 if cfg.vehiculos_disponibles is null then perform private.raise_cohort_error('CAPACIDAD_CONFIG_REQUERIDA');end if;
 select co.* into c from public.cohorts co join public.courses cu on cu.id=co.course_id
 where cu.tipo=e.course_type and co.habilitada and co.cancelled_at is null
  and co.fecha_inicio_matricula<=co.fecha_fin_matricula and co.fecha_fin_matricula<=co.fecha_fin_curso
  and private.cohortes_now()>=co.fecha_inicio_matricula::timestamp at time zone 'America/Guayaquil'
  and private.cohortes_now()<(co.fecha_fin_matricula-4)::timestamp at time zone 'America/Guayaquil'
  and (plan->>'fechaInicioEfectiva')::date>=co.fecha_inicio_curso and (plan->>'ultimaFecha')::date<=co.fecha_fin_curso
  and private.cohort_peak_v2(co.id,(plan->>'fechaInicioEfectiva')::date,(plan->>'ultimaFecha')::date,e.id)<co.cupo_maximo
 order by co.fecha_fin_curso,co.id limit 1;
 for d in select value from jsonb_array_elements(plan->'dias') loop
  free:=c.id is not null and exists(select 1 from public.enrollment_plan_options where modalidad=p_input->>'modalidad'
   and horas_por_dia=(p_input->>'horasPorDia')::integer and habilitada);
  foreach t in array slots loop
   if (t at time zone 'America/Guayaquil')::date<>(d->>'fecha')::date then continue;end if;
   if not exists(select 1 from private.free_instructors_v2(array[t],p_student,null)) or exists(
    select 1 from public.practice_slots ps where ps.student_id=p_student and ps.status in ('asignado','confirmado','completado')
      and abs(extract(epoch from(ps.scheduled_at-t)))<3600) or exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations r on r.id=h.reservation_id where r.student_id=p_student and h.released_at is null and(h.payment_protected or h.expira_at>private.cohortes_now()) and abs(extract(epoch from(h.scheduled_at-t)))<3600) then free:=false;end if;
  end loop;
  if not free then bad:=bad||jsonb_build_array(d->>'fecha');all_free:=false;end if;
  days:=days||jsonb_build_array(d||jsonb_build_object('disponible',free));
 end loop;
 return plan||jsonb_build_object('dias',days,'factible',all_free,'diasFallan',bad,'serverNow',private.cohortes_now(),
  'precioCentavos',(select precio_centavos from public.course_type_prices where tipo=e.course_type));
end $$;

-- La bandeja existente se amplía a su propietario admin, sin otra pantalla.
create or replace function private.assert_notification_owner(p_user uuid) returns void language plpgsql stable security invoker set search_path='' as $$begin
 if not exists(select 1 from public.users where id=p_user and activo and rol in('estudiante','instructor','admin')) then raise exception 'Cuenta inactiva o sin acceso a notificaciones' using errcode='CD403';end if;
end $$;
create or replace function private.notification_close_l11() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.domain_code is not null and new.domain_resolved_at is not null and old.domain_resolved_at is null then new.read_at:=coalesce(new.read_at,private.cohortes_now());end if;return new;end $$;
drop trigger if exists notification_close_l11 on public.notifications;
create trigger notification_close_l11 before update of domain_resolved_at on public.notifications for each row execute function private.notification_close_l11();
-- Cierre de todas las superficies nuevas y copias heredadas.
do $$declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and(p.proname like '%l11%' or p.proname in('assert_enrollment_permission_v2','manual_plan_preview_v2','integrated_manual_commit_v2','integrated_manual_details_v2','record_schedule_choice_v2','enrollment_metrics_v2','enrollment_job_heartbeat_v2','monitor_enrollment_rules_v2','report_enrollment_security_v2','commit_manual_enrollment','update_manual_enrollment_details','student_schedule_calendar_v2','student_schedule_preview_v2','reserve_manual_enrollment','find_manual_students','find_manual_students_v2','save_student_profile','set_student_active','restore_student_practice','assign_pending_enrollment_cohort','admin_release_student_reservation','confirmar_identidad_presencial_admin','registrar_verificacion_inscripcion','revisar_documento_solicitud','reclamar_aprobacion_inscripcion','finalizar_aprobacion_inscripcion','finalizar_aprobacion_solicitud','rechazar_solicitud_inscripcion','devolver_solicitud_inscripcion','begin_student_payment','begin_student_deletion','delete_student_data')) loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;end $$;
revoke all on private.cohort_alert_causes_l11 from public,anon,authenticated;
grant select on private.cohort_alert_causes_l11 to service_role;
update public.enrollment_rule_flags set implemented=true,enabled=false,reason='Lote 11: integración local pendiente de activación explícita' where key in('permissions','metrics');
commit;

-- L12a. D1–D8/D10. Guardas de cuerpos se congelan al instalar el manifiesto local final.
begin;
set local lock_timeout='5s';
-- Copias de cuerpos vigentes para rollback funcional, sin tabla nueva.
do $$declare r record;backup text;definition text;begin
 for r in select p.oid,p.proname,n.nspname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f' and p.proname not like 'backup081_%' and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
 backup:='backup081_'||md5(r.nspname||'.'||r.proname||'('||r.args||')');
 if not exists(select 1 from pg_proc bp join pg_namespace bn on bn.oid=bp.pronamespace where bn.nspname='private' and bp.proname=backup) then
 definition:=replace(pg_get_functiondef(r.oid),format('FUNCTION %I.%I(',r.nspname,r.proname),format('FUNCTION private.%I(',backup));execute definition;
 execute format('comment on function private.%I(%s) is %L',backup,r.args,jsonb_build_object('schema',r.nspname,'name',r.proname)::text);
 execute format('revoke all on function private.%I(%s) from public,anon,authenticated',backup,r.args);end if;
 end loop;end $$;
insert into public.app_settings(id) values(true) on conflict(id) do nothing;
drop index if exists public.enrollments_one_active_per_student;
-- D1 se mantiene también al apagar flujos: nunca reinstalar la unicidad global.
create or replace function private.enrollment_access_activation() returns trigger language plpgsql security invoker set search_path='' as $$begin return new;end $$;
alter table public.app_settings add column if not exists practicas_hora_fin integer not null default 22 check(practicas_hora_fin between 7 and 24);
alter table public.cohorts alter column precio set default 0;
update public.app_settings set vehiculos_disponibles=null where id;
-- Instantánea de administradores existentes: reaplicar NO concede permisos a admins futuros.
do $$declare admins jsonb;begin
 if not exists(select 1 from public.enrollment_domain_audit where action='admin_snapshot_081' and entity_id='081') then
 select coalesce(jsonb_agg(id order by id),'[]') into admins from public.users where rol='admin';
 insert into public.enrollment_domain_audit(action,entity_type,entity_id,new_value,reason) values('admin_snapshot_081','migration','081',jsonb_build_object('admins',admins),'D8 autorizado: cuatro permisos a administradores existentes al aplicar 081');
 insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason)
 select u.id,p,u.id,'Migración 081, decisión D8 del dueño' from public.users u cross join unnest(array['verify_identity','manage_cohorts_prices','reassign_schedules','view_payments_invoices']) p where u.rol='admin'
 on conflict(admin_id,permission) do update set revoked_at=null,reason=excluded.reason;
 end if;end $$;
create or replace function private.lock_student_schedule_v12(p_student uuid) returns void language plpgsql security invoker set search_path='' as $$begin
 if p_student is null then perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule:'||p_student::text,0));
end $$;
create or replace function private.own_schedule_conflict_v12(p_student uuid,p_slots timestamptz[],p_skip_enrollment uuid default null,p_skip_reservation uuid default null,p_skip_slot uuid default null)
returns jsonb language sql volatile security invoker set search_path='' as $$
 with conflicts as (
 select s.scheduled_at,coalesce(cu.nombre,'Tipo '||e.course_type::text) course from public.practice_slots s join public.cohorts c on c.id=s.cohort_id join public.courses cu on cu.id=c.course_id
 left join public.enrollments e on e.id=p_skip_enrollment
 where s.id is distinct from p_skip_slot and s.student_id=p_student and s.status in('asignado','confirmado','completado') and exists(select 1 from unnest(p_slots) t where s.scheduled_at<t+interval '1 hour' and s.scheduled_at+interval '1 hour'>t)
 and not(e.id is not null and e.cohort_id=s.cohort_id and (s.scheduled_at at time zone 'America/Guayaquil')::date between e.practice_start_date and e.practice_end_date and s.status in('asignado','confirmado'))
 union all select h.scheduled_at,'Tipo '||r.course_type::text from public.student_schedule_holds h join public.student_schedule_reservations r on r.id=h.reservation_id
 where r.student_id=p_student and r.id is distinct from p_skip_reservation and h.released_at is null and(h.payment_protected or(r.estado in('vigente','pago_en_curso') and(r.expira_at>private.cohortes_now() or r.estado='pago_en_curso')))
 and exists(select 1 from unnest(p_slots) t where h.scheduled_at<t+interval '1 hour' and h.scheduled_at+interval '1 hour'>t)
 ) select jsonb_build_object('course',course,'date',to_char(scheduled_at at time zone 'America/Guayaquil','YYYY-MM-DD'),'hour',to_char(scheduled_at at time zone 'America/Guayaquil','HH24:MI'),
 'message','Se solapa con tu práctica de '||course||' del '||to_char(scheduled_at at time zone 'America/Guayaquil','YYYY-MM-DD')||' a las '||to_char(scheduled_at at time zone 'America/Guayaquil','HH24:MI')||'. Elige otra hora.') from conflicts order by scheduled_at limit 1
$$;
create or replace function private.assert_own_schedule_v12(p_student uuid,p_slots timestamptz[],p_skip_enrollment uuid default null,p_skip_reservation uuid default null,p_skip_slot uuid default null)
returns void language plpgsql security invoker set search_path='' as $$declare conflict jsonb;begin
 perform private.lock_student_schedule_v12(p_student);conflict:=private.own_schedule_conflict_v12(p_student,p_slots,p_skip_enrollment,p_skip_reservation,p_skip_slot);
 if conflict is not null then perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO',conflict);end if;end $$;
-- Serializar también rutas heredadas y reprogramación, antes de cualquier otro candado.
do $$declare r record;def text;student_arg text;begin
 for r in select p.oid,p.proname,p.proargnames,l.lanname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in('public','private') and l.lanname='plpgsql' and(p.proname ~ '(reserve|reservation|plan_change|practice|swap)') and ('p_student'=any(p.proargnames) or 'p_student_id'=any(p.proargnames)) loop
 student_arg:=case when 'p_student'=any(r.proargnames) then 'p_student' else 'p_student_id' end;
 def:=pg_get_functiondef(r.oid);
 if position('lock_student_schedule_v12' in def)=0 then
 def:=regexp_replace(def,'\mbegin\M',format('begin if private.enrollment_rule_enabled(''reservations'') then perform private.lock_student_schedule_v12(%I);end if;',student_arg),'i');execute def;end if;
 end loop;end $$;
-- Retirar el límite físico y la exigencia de configuración de TODAS sus vías.
do $$declare r record;def text;begin
 for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname not like 'backup081_%' and position('vehiculos_disponibles' in p.prosrc)>0 loop
 def:=pg_get_functiondef(r.oid);
 def:=replace(def,'if cfg.vehiculos_disponibles is null then perform private.raise_cohort_error(''CAPACIDAD_CONFIG_REQUERIDA'');end if;','');
 def:=replace(def,'if vehicles is null then perform private.raise_cohort_error(''CAPACIDAD_CONFIG_REQUERIDA'');end if;','if vehicles is null then vehicles:=2147483647;end if;');
 def:=replace(def,'coalesce(vehiculos_disponibles,0)','2147483647');
 def:=replace(def,'coalesce((select vehiculos_disponibles from public.app_settings where id),0)','2147483647');
 def:=replace(def,'or not exists(select 1 from public.app_settings where id and vehiculos_disponibles is not null)','');
 execute def;
 end loop;
end $$;
create or replace function private.vehicle_occupation_v2(p_at timestamptz,p_skip_slot uuid default null,p_skip_reservation uuid default null) returns integer language sql volatile security invoker set search_path='' as $$select 0$$;
-- Constructor SQL: una sola fuente del tope horario configurable.
do $$declare def text;begin
 def:=pg_get_functiondef('private.enrollment_plan_v2(jsonb)'::regprocedure);
 def:=replace(def,' IMMUTABLE',' STABLE');def:=replace(def,'v_n int;','v_limit int:=coalesce((select practicas_hora_fin from public.app_settings where id),22);v_n int;');
 def:=replace(def,'2[01]','2[0-3]');def:=replace(def,'v_hour+v_hours>22','v_hour+v_hours>v_limit');execute def;
 -- Los barridos de horas de calendario/espera usan el mismo tope.
 for def in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname not like 'backup081_%' and(p.prosrc like '%6..22-%') loop
 execute replace(def,'6..22-','6..coalesce((select practicas_hora_fin from public.app_settings where id),22)-');end loop;
end $$;
-- Comprobar el plan completo antes de retener; cambio ignora únicamente su plan original.
do $$declare def text;begin
 def:=pg_get_functiondef('private.reserve_schedule_v2(uuid,uuid,jsonb)'::regprocedure);
 def:=replace(def,'v_start:=(plan->>','perform private.assert_own_schedule_v12(p_student,slots);v_start:=(plan->>');execute def;
 def:=pg_get_functiondef('private.reserve_plan_change_v2(uuid,uuid,jsonb,uuid,text,boolean,uuid)'::regprocedure);
 def:=replace(def,'perform 1 from public.cohorts where course_id','perform private.assert_own_schedule_v12(p_student,slots,p_enrollment);perform 1 from public.cohorts where course_id');execute def;
end $$;
create or replace function private.hold_student_guard_v12() returns trigger language plpgsql security invoker set search_path='' as $$declare r public.student_schedule_reservations;begin
 if not private.enrollment_rule_enabled('reservations') or new.released_at is not null then return new;end if;
 select * into strict r from public.student_schedule_reservations where id=new.reservation_id;
 perform private.assert_own_schedule_v12(r.student_id,array[new.scheduled_at],r.replacement_enrollment_id,r.id);return new;end $$;
drop trigger if exists holds_00_student_v12 on public.student_schedule_holds;
create trigger holds_00_student_v12 before insert or update of scheduled_at,reservation_id on public.student_schedule_holds for each row execute function private.hold_student_guard_v12();
create or replace function private.student_slot_guard_l11() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if not private.enrollment_rule_enabled('reservations') or new.student_id is null or new.status not in('asignado','confirmado','completado') then return new;end if;
 perform private.lock_student_schedule_v12(new.student_id);
 if exists(select 1 from public.practice_slots s where s.id is distinct from new.id and s.student_id=new.student_id and s.status in('asignado','confirmado','completado') and abs(extract(epoch from(s.scheduled_at-new.scheduled_at)))<3600) then perform private.raise_cohort_error('RESERVA_SOLAPE_PROPIO');end if;
 if exists(select 1 from public.users where id=new.student_id and identity_access_blocked_at is not null) then perform private.raise_cohort_error('SOLICITUD_ACCESO_REVOCADO');end if;return new;end $$;
-- D3: retirar avisos del límite físico ya obsoleto.
update public.notifications set domain_resolved_at=clock_timestamp(),read_at=coalesce(read_at,clock_timestamp()) where domain_code='CAPACIDAD_VEHICULOS_EXCEDIDA' and domain_resolved_at is null;
do $$declare definition text;begin definition:=pg_get_functiondef('private.enrollment_current_guard()'::regprocedure);execute replace(definition,'if not private.enrollment_rule_enabled(''enrollment_access'') then return new;end if;','');end $$;
create or replace function public.set_vehicle_capacity_v2(p_actor uuid,p_count integer,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');return jsonb_build_object('retired',true,'vehiculos',null,'horasSobreLimite',0);end $$;
do $$begin if to_regprocedure('public.base081_schedule_preview(uuid,uuid,jsonb)') is null then alter function public.student_schedule_preview_v2(uuid,uuid,jsonb) rename to base081_schedule_preview;end if;
 if to_regprocedure('public.base081_swap_practice_slot(uuid,uuid,uuid)') is null then alter function public.swap_practice_slot(uuid,uuid,uuid) rename to base081_swap_practice_slot;end if;end $$;
create or replace function public.student_schedule_preview_v2(p_student uuid,p_enrollment uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare result jsonb;plan jsonb;slots timestamptz[];conflict jsonb;begin
 result:=public.base081_schedule_preview(p_student,p_enrollment,p_input);plan:=private.enrollment_plan_v2(p_input);
 select array_agg(value::timestamptz) into slots from jsonb_array_elements_text(plan->'franjas');conflict:=private.own_schedule_conflict_v12(p_student,slots);
 if conflict is not null then result:=result||jsonb_build_object('factible',false,'conflict',conflict);end if;return result;end $$;
create or replace function public.swap_practice_slot(p_slot_id uuid,p_student_id uuid,p_source_slot_id uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$declare t timestamptz;begin
 if private.enrollment_rule_enabled('reservations') then perform private.lock_student_schedule_v12(p_student_id);select scheduled_at into t from public.practice_slots where id=p_slot_id;perform private.assert_own_schedule_v12(p_student_id,array[t],null,null,p_source_slot_id);end if;
 return public.base081_swap_practice_slot(p_slot_id,p_student_id,p_source_slot_id);end $$;
revoke all on function public.student_schedule_preview_v2(uuid,uuid,jsonb),public.base081_schedule_preview(uuid,uuid,jsonb),public.swap_practice_slot(uuid,uuid,uuid),public.base081_swap_practice_slot(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.student_schedule_preview_v2(uuid,uuid,jsonb),public.base081_schedule_preview(uuid,uuid,jsonb),public.swap_practice_slot(uuid,uuid,uuid),public.base081_swap_practice_slot(uuid,uuid,uuid) to service_role;
-- ACL: funciones nuevas exclusivamente para el backend.
do $$declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like '%v12%' loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;end $$;
commit;
