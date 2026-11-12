-- L7. Un segundo plan retenido en las MISMAS reservas; el original sigue activo.
begin;
set local lock_timeout='5s';
alter table public.app_settings add column if not exists cambios_plan_gratis integer not null default 1 check(cambios_plan_gratis>=0),
 add column if not exists cambio_plan_anticipacion_horas integer not null default 48 check(cambio_plan_anticipacion_horas>=48);
alter table public.student_schedule_reservations add column if not exists replacement_enrollment_id uuid references public.enrollments(id) on delete cascade,
 add column if not exists change_requested_by uuid,add column if not exists change_reason text,
 add column if not exists change_is_reassignment boolean not null default false,
 add column if not exists original_plan_snapshot jsonb,add column if not exists change_confirmed_at timestamptz;

-- Proyección por inscripción: el plan anterior y su alternativa no duplican un
-- vehículo en una misma hora. Barrido temporal también cubre franjas no alineadas.
alter function private.vehicle_occupation_v2(timestamptz,uuid,uuid) rename to legacy076_vehicle_occupation_v2;
create function private.vehicle_occupation_v2(p_at timestamptz,p_skip_slot uuid default null,p_skip_reservation uuid default null)
returns integer language sql volatile security invoker set search_path='' as $$
 with periods as (
  select coalesce((select 'e:'||e.id::text from public.enrollments e where e.student_id=s.student_id and e.cohort_id=s.cohort_id
    and e.status in ('activo','finalizado') order by e.created_at desc,e.id limit 1),'s:'||s.id::text) unit,
   greatest(s.scheduled_at,p_at) a,least(s.scheduled_at+interval '1 hour',p_at+interval '1 hour') b
  from public.practice_slots s where s.id is distinct from p_skip_slot and s.student_id is not null
   and s.status in ('asignado','confirmado','completado') and s.scheduled_at<p_at+interval '1 hour' and s.scheduled_at+interval '1 hour'>p_at
  union all
  select 'e:'||r.enrollment_id::text,greatest(h.scheduled_at,p_at),least(h.scheduled_at+interval '1 hour',p_at+interval '1 hour')
   from public.student_schedule_holds h join public.student_schedule_reservations r on r.id=h.reservation_id
   where h.reservation_id is distinct from p_skip_reservation and h.released_at is null and(h.payment_protected or h.expira_at>private.cohortes_now())
    and h.scheduled_at<p_at+interval '1 hour' and h.scheduled_at+interval '1 hour'>p_at
 ), merged as(select unit,range_agg(tstzrange(a,b,'[)')) ranges from periods where a<b group by unit),
 intervals as(select unnest(ranges) r from merged),events as(select lower(r) t,1 delta from intervals union all select upper(r),-1 from intervals),
 totals as(select t,sum(delta) delta from events group by t),running as(select t,sum(delta) over(order by t) n from totals)
 select coalesce(max(n) filter(where t<p_at+interval '1 hour'),0)::integer from running
$$;
create or replace function private.change_free_instructors_v2(p_at timestamptz,p_enrollment uuid,p_skip_reservation uuid default null)
returns table(id uuid) language sql volatile security invoker set search_path='' as $$
 select u.id from public.users u cross join public.enrollments e where e.id=p_enrollment and u.rol='instructor' and u.activo
 and not exists(select 1 from public.practice_slots s where s.instructor_id=u.id and s.status in ('disponible','asignado','confirmado','liberado','completado')
  and not(s.student_id=e.student_id and s.cohort_id=e.cohort_id and s.status in ('asignado','confirmado'))
  and not(s.student_id is null and s.status in ('disponible','liberado') and s.scheduled_at=p_at)
  and s.scheduled_at<p_at+interval '1 hour' and s.scheduled_at+interval '1 hour'>p_at)
 and not exists(select 1 from public.student_schedule_holds h where h.instructor_id=u.id and h.reservation_id is distinct from p_skip_reservation
  and h.released_at is null and(h.payment_protected or h.expira_at>private.cohortes_now())
  and h.scheduled_at<p_at+interval '1 hour' and h.scheduled_at+interval '1 hour'>p_at)
 and private.vehicle_occupation_v2(p_at,null,p_skip_reservation)<=(select coalesce(vehiculos_disponibles,0) from public.app_settings where id)
  -case when exists(select 1 from public.practice_slots old where old.student_id=e.student_id and old.cohort_id=e.cohort_id and old.status in ('asignado','confirmado')
    and old.scheduled_at<p_at+interval '1 hour' and old.scheduled_at+interval '1 hour'>p_at) then 0 else 1 end
 order by (select count(*) from public.practice_slots s where s.instructor_id=u.id and s.student_id=e.student_id) desc,
 (select count(*) from public.practice_slots s where s.instructor_id=u.id and(s.scheduled_at at time zone 'America/Guayaquil')::date=(p_at at time zone 'America/Guayaquil')::date)
 +(select count(*) from public.student_schedule_holds h where h.instructor_id=u.id and h.released_at is null and(h.payment_protected or h.expira_at>private.cohortes_now())
  and(h.scheduled_at at time zone 'America/Guayaquil')::date=(p_at at time zone 'America/Guayaquil')::date),u.id
$$;

create or replace function private.assert_change_plan_v2(p_student uuid,p_enrollment uuid,p_actor uuid,p_reassignment boolean)
returns public.enrollments language plpgsql security invoker set search_path='' as $$
declare e public.enrollments;first_slot timestamptz;cfg public.app_settings;begin
 if p_actor is not null then perform private.require_enrollment_permission(p_actor,'reassign_schedules');end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then perform private.raise_cohort_error('MATRICULA_CUENTA_NO_HABILITADA');end if;
 if not private.enrollment_rule_enabled('schedule_changes') then perform private.raise_cohort_error('PLAN_CAMBIO_REGLAS_INACTIVAS');end if;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student for update;
 if not found then perform private.raise_cohort_error('MATRICULA_AJENA');end if;
 if e.status<>'activo' or e.etapa_inscripcion<>'activa' or e.paid_amount_centavos is null or not e.individual_dates_guard_ready then
  perform private.raise_cohort_error('PLAN_CAMBIO_ESTADO_INVALIDO');end if;
 select * into cfg from public.app_settings where id;
 select min(scheduled_at) into first_slot from public.practice_slots where student_id=p_student and cohort_id=e.cohort_id and status in ('asignado','confirmado','completado');
 if first_slot is null then perform private.raise_cohort_error('CAPACIDAD_HISTORICO_PENDIENTE');end if;
 -- El permiso permite saltar el cierre, no la ventana de 48 horas del contrato.
 if private.cohortes_now()>first_slot-make_interval(hours=>cfg.cambio_plan_anticipacion_horas) then
  perform private.raise_cohort_error('PLAN_CAMBIO_FUERA_PLAZO');end if;
 if not p_reassignment and(select count(*) from public.student_schedule_reservations where replacement_enrollment_id=e.id and estado='confirmada' and not change_is_reassignment)>=cfg.cambios_plan_gratis then
  perform private.raise_cohort_error('PLAN_CAMBIO_LIMITE');end if;
 return e;
end $$;
create or replace function private.change_plan_candidate_v2(p_enrollment uuid,p_input jsonb,p_reassignment boolean,p_target uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$ declare e public.enrollments;c uuid;plan jsonb;begin
 select * into e from public.enrollments where id=p_enrollment;
 plan:=private.enrollment_plan_v2(p_input);perform private.assert_enrollment_plan_future(plan,private.cohortes_now());
 if not exists(select 1 from public.enrollment_plan_options where modalidad=p_input->>'modalidad' and horas_por_dia=(p_input->>'horasPorDia')::integer and habilitada) then
  perform private.raise_cohort_error('PLAN_OPCION_NO_OFERTADA');end if;
 select co.id into c from public.cohorts co join public.courses cu on cu.id=co.course_id where cu.tipo=e.course_type and co.habilitada and co.cancelled_at is null
 and(p_target is null or co.id=p_target) and(plan->>'fechaInicioEfectiva')::date>=co.fecha_inicio_curso and(plan->>'ultimaFecha')::date<=co.fecha_fin_curso
 and(p_reassignment or(private.cohort_calendar_v2(co.fecha_inicio_matricula,co.fecha_fin_matricula,co.fecha_inicio_curso,co.fecha_fin_curso,co.habilitada,private.cohortes_now())->>'open')::boolean)
 and private.cohort_peak_v2(co.id,(plan->>'fechaInicioEfectiva')::date,(plan->>'ultimaFecha')::date,e.id)<co.cupo_maximo
 order by co.fecha_fin_curso,co.id limit 1;
 if c is null then perform private.raise_cohort_error('RESERVA_SIN_HORARIOS');end if;return c;
end $$;

create or replace function private.reserve_plan_change_v2(p_student uuid,p_enrollment uuid,p_input jsonb,p_actor uuid default null,p_reason text default null,p_reassignment boolean default false,p_target uuid default null)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.enrollments;r public.student_schedule_reservations;plan jsonb;slots timestamptz[];t timestamptz;i uuid;target uuid;v_now timestamptz;cfg public.app_settings;expired int;last_expired timestamptz;begin
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
 perform 1 from public.cohorts where course_id in(select id from public.courses where tipo=e.course_type) order by id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 v_now:=private.cohortes_now();e:=private.assert_change_plan_v2(p_student,p_enrollment,p_actor,p_reassignment);perform private.assert_enrollment_plan_future(plan,v_now);
 select * into cfg from public.app_settings where id;
 if cfg.vehiculos_disponibles is null then perform private.raise_cohort_error('CAPACIDAD_CONFIG_REQUERIDA');end if;
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
 coalesce(p_reason,'Cambio de plan solicitado por el alumno'),p_reassignment,to_jsonb(e)) returning * into r;
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
end $$;

create or replace function private.confirm_plan_change_v2(p_student uuid,p_reservation uuid,p_actor uuid default null)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.enrollments;r public.student_schedule_reservations;h public.student_schedule_holds;i uuid;slot_id uuid;first_slot timestamptz;begin
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
 if (select count(*) from public.student_schedule_holds where reservation_id=r.id and released_at is null)<>15 then perform private.raise_cohort_error('PLAN_CAMBIO_RETENCION_INCOMPLETA');end if;
 if exists(select 1 from public.student_schedule_holds retained join public.users u on u.id=retained.instructor_id where retained.reservation_id=r.id and(not u.activo or u.rol<>'instructor' or retained.scheduled_at<=private.cohortes_now())) then
  perform private.raise_cohort_error('CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE');end if;
 -- Liberar y reasignar dentro de la misma transacción; cualquier error revierte ambos.
 update public.student_schedule_holds set released_at=private.cohortes_now() where reservation_id=r.id;
 update public.practice_slots set student_id=null,status='liberado' where student_id=p_student and cohort_id=e.cohort_id and status in ('asignado','confirmado');
 update public.enrollments set cohort_id=r.cohort_id,course_id=(select course_id from public.cohorts where id=r.cohort_id),
 practice_start_date=r.practice_start_date,practice_end_date=r.practice_end_date,
 access_end_date=case when access_extended_at is null then r.practice_end_date else greatest(access_end_date,r.practice_end_date) end,
 individual_dates_source='reservation_holds' where id=e.id;
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
end $$;

-- Corrección de integración de L5: evidencia nueva de pago/holds, independiente
-- de activar cambios de plan. Se conserva en el rollback funcional de L7.
create or replace function private.mark_payment_dates_proven() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if new.estado='aprobado' then
  update public.enrollments e set individual_dates_guard_ready=true from public.student_schedule_reservations r
  where r.id=new.reservation_id and new.enrollment_id=e.id and r.admission_rule_version='070' and not e.individual_dates_guard_ready and e.individual_dates_source='reservation_holds'
  and e.practice_start_date=r.practice_start_date and e.practice_end_date=r.practice_end_date and e.paid_amount_centavos=new.total_centavos
  and(select count(*) from public.student_schedule_holds where reservation_id=r.id)=15;
 end if;return new;
end $$;
drop trigger if exists payments_00_dates_proven on public.payments;
create trigger payments_00_dates_proven after insert or update of estado on public.payments for each row execute function private.mark_payment_dates_proven();

-- Lectura, previsualización y reserva se exponen solo al backend; nunca reciben
-- cohorte/instructor/precio desde el alumno.
create or replace function public.reserve_student_plan_change_v2(p_student uuid,p_enrollment uuid,p_input jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.reserve_plan_change_v2(p_student,p_enrollment,p_input)
$$;
create or replace function public.confirm_student_plan_change_v2(p_student uuid,p_reservation uuid) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.confirm_plan_change_v2(p_student,p_reservation)
$$;
create or replace function public.preview_student_plan_change_v2(p_student uuid,p_enrollment uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare result jsonb;begin
 -- Ensayo transaccional: no retiene recursos ni deja auditoría al devolver la vista.
 begin
  result:=private.reserve_plan_change_v2(p_student,p_enrollment,p_input);
  raise exception using errcode='P7600';
 exception when sqlstate 'P7600' then return jsonb_build_object('franjas',result->'franjas','precioCentavos',result->'precioCentavos','serverNow',result->'serverNow','factible',true);end;
end $$;

create or replace function private.plan_change_state_v2(p_student uuid,p_enrollment uuid,p_actor uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare e public.enrollments;r uuid;allowed boolean:=true;code text;first_slot timestamptz;remaining integer;begin
 if p_actor is not null then perform private.require_enrollment_permission(p_actor,'reassign_schedules');end if;
 if not private.enrollment_rule_enabled('schedule_changes') then return jsonb_build_object('active',false);end if;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student;
 if not found then perform private.raise_cohort_error('MATRICULA_AJENA');end if;
 perform private.expire_reservations_v2(p_student);
 begin perform private.assert_change_plan_v2(p_student,p_enrollment,p_actor,p_actor is not null);
 exception when sqlstate 'P7000' then allowed:=false;get stacked diagnostics code=message_text;end;
 select id into r from public.student_schedule_reservations where replacement_enrollment_id=e.id order by creada_at desc,id limit 1;
 select min(scheduled_at) into first_slot from public.practice_slots where student_id=p_student and cohort_id=e.cohort_id and status in ('asignado','confirmado','completado');
 select greatest(cambios_plan_gratis-(select count(*) from public.student_schedule_reservations where replacement_enrollment_id=e.id and estado='confirmada' and not change_is_reassignment),0)::integer into remaining from public.app_settings where id;
 return jsonb_build_object('active',true,'studentId',p_student,'canChange',allowed,'reasonCode',code,'serverNow',private.cohortes_now(),
 'windowClosesAt',first_slot-make_interval(hours=>(select cambio_plan_anticipacion_horas from public.app_settings where id)),
 'calendarEndDate',(select max(c.fecha_fin_curso) from public.cohorts c join public.courses cu on cu.id=c.course_id where cu.tipo=e.course_type and c.habilitada and c.cancelled_at is null),
 'freeRemaining',remaining,'reservation',case when r is null then null else private.reservation_json_v2(r) end,
 'current',jsonb_build_object('practiceStartDate',e.practice_start_date,'practiceEndDate',e.practice_end_date,'accessEndDate',e.access_end_date));
end $$;
create or replace function public.student_plan_change_state_v2(p_student uuid,p_enrollment uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select private.plan_change_state_v2(p_student,p_enrollment)$$;

create or replace function private.change_calendar_v2(p_student uuid,p_enrollment uuid,p_month date,p_mode text,p_hours integer,p_actor uuid default null,p_target uuid default null)
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare e public.enrollments;d date;h integer;plan jsonb;target uuid;t text;ok boolean;rows jsonb:='[]';begin
 e:=private.assert_change_plan_v2(p_student,p_enrollment,p_actor,p_actor is not null);
 if p_month is null or not isfinite(p_month) or p_month<>date_trunc('month',p_month)::date or p_mode not in('entre_semana','fin_de_semana') or p_hours not between 1 and 6 then perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 for d in select generate_series(p_month,p_month+interval '1 month'-interval '1 day',interval '1 day')::date loop
  ok:=false;
  if d>=(private.cohortes_now() at time zone 'America/Guayaquil')::date and((extract(isodow from d) in(6,7))=(p_mode='fin_de_semana')) then
   for h in 6..22-p_hours loop
    begin
     plan:=private.enrollment_plan_v2(jsonb_build_object('fechaInicio',d,'modalidad',p_mode,'horasPorDia',p_hours,'horaInicio',h));
     target:=private.change_plan_candidate_v2(e.id,jsonb_build_object('fechaInicio',d,'modalidad',p_mode,'horasPorDia',p_hours,'horaInicio',h),p_actor is not null,p_target);
     ok:=target is not null;
     for t in select value from jsonb_array_elements_text(plan->'franjas') loop
      if not exists(select 1 from private.change_free_instructors_v2(t::timestamptz,e.id)) or exists(select 1 from public.practice_slots busy where busy.student_id=p_student and busy.cohort_id<>e.cohort_id and busy.status in('asignado','confirmado','completado') and busy.scheduled_at<t::timestamptz+interval '1 hour' and busy.scheduled_at+interval '1 hour'>t::timestamptz) then ok:=false;exit;end if;
     end loop;
     if ok then exit;end if;
    exception when sqlstate 'P7000' then
     if sqlerrm not in('RESERVA_SIN_HORARIOS','PLAN_FRANJA_PASADA','PLAN_INICIO_PASADO','PLAN_OPCION_NO_OFERTADA') then raise;end if;ok:=false;
    end;
   end loop;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('fecha',d,'disponible',ok));
 end loop;
 return jsonb_build_object('serverNow',private.cohortes_now(),'dias',rows);
end $$;
create or replace function public.student_plan_change_calendar_v2(p_student uuid,p_enrollment uuid,p_month date,p_mode text,p_hours integer) returns jsonb language sql volatile security invoker set search_path='' as $$select private.change_calendar_v2(p_student,p_enrollment,p_month,p_mode,p_hours)$$;

-- Metadato compatible para que caja/pasarela no ofrezcan cobrar un cambio.
alter function private.reservation_json_v2(uuid) rename to legacy076_reservation_json_v2;
create function private.reservation_json_v2(p_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.legacy076_reservation_json_v2(p_id)||jsonb_build_object('purpose',case when replacement_enrollment_id is null then 'initial' else 'plan_change' end)
 from public.student_schedule_reservations where id=p_id
$$;
-- Cerrar una reserva de cambio nunca cambia la matrícula activa original.
-- Despacho por versión conserva ese comportamiento aun al apagar indicadores.
alter function public.manage_student_reservation(uuid,text,uuid,integer,integer,integer) rename to legacy076_manage_student_reservation;
create function public.manage_student_reservation(p_student uuid,p_accion text,p_id uuid default null,p_extension integer default 10,p_max_extensiones integer default 1,p_gracia integer default 10)
returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 if exists(select 1 from public.student_schedule_reservations where student_id=p_student and(p_id is null or id=p_id) and replacement_enrollment_id is not null and estado in ('vigente','pago_en_curso')) then
  if p_accion='iniciar_pago' then perform private.raise_cohort_error('PLAN_CAMBIO_SIN_COBRO');end if;
  return private.manage_reservation_v2(p_student,p_accion,p_id);end if;
 return public.legacy076_manage_student_reservation(p_student,p_accion,p_id,p_extension,p_max_extensiones,p_gracia);
end $$;
alter function public.expire_student_reservations(uuid) rename to legacy076_expire_student_reservations;
create function public.expire_student_reservations(p_student uuid) returns integer language plpgsql security invoker set search_path='' as $$ begin
 if exists(select 1 from public.student_schedule_reservations where student_id=p_student and replacement_enrollment_id is not null) then return private.expire_reservations_v2(p_student);end if;
 return public.legacy076_expire_student_reservations(p_student);
end $$;
alter function public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text) rename to legacy076_begin_student_payment;
create function public.begin_student_payment(p_student uuid,p_reserva uuid,p_proveedor text,p_attempt uuid,p_recargo integer default 0,p_gracia integer default 10,p_actor uuid default null,p_comprobante text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 if exists(select 1 from public.student_schedule_reservations where id=p_reserva and student_id=p_student and replacement_enrollment_id is not null) then perform private.raise_cohort_error('PLAN_CAMBIO_SIN_COBRO');end if;
 return public.legacy076_begin_student_payment(p_student,p_reserva,p_proveedor,p_attempt,p_recargo,p_gracia,p_actor,p_comprobante);
end $$;

do $$ declare expression text;begin
 select pg_get_expr(conbin,conrelid) into expression from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_tipo_check';
 if position('plan_cambiado' in expression)=0 then alter table public.notifications drop constraint notifications_tipo_check;
 execute format('alter table public.notifications add constraint notifications_tipo_check check ((%s) or tipo=%L)',expression,'plan_cambiado');end if;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and(p.proname in('vehicle_occupation_v2','change_free_instructors_v2','assert_change_plan_v2','change_plan_candidate_v2','reserve_plan_change_v2','confirm_plan_change_v2','reservation_json_v2','mark_payment_dates_proven','plan_change_state_v2','change_calendar_v2') or p.proname like 'legacy076_%'))
 or(n.nspname='public' and(p.proname in('reserve_student_plan_change_v2','confirm_student_plan_change_v2','preview_student_plan_change_v2','student_plan_change_state_v2','student_plan_change_calendar_v2','manage_student_reservation','expire_student_reservations','begin_student_payment') or p.proname like 'legacy076_%')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
-- 077 completa reasignación masiva y cancelación antes de marcar implementado.
notify pgrst,'reload schema';
commit;
