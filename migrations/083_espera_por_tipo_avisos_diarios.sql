-- L12b: marca por tipo sin preferencias; notificación manual, agrupada y acotada.
begin;
set local lock_timeout='5s';
-- GUARDA-MD5 INICIO (hash congelado de la instalación local; md5(replace(prosrc,chr(13),'')))
do $guard$declare g record;begin
 for g in select * from (values
  ('private.waitlist_email_delivered_v2()','d62024895dfad57e0f4a0353fc0a73a8'),
  ('public.claim_notification_email()','fc50682ebc9b52557599bc551aa103de'),
  ('public.enqueue_waitlist_event_v2(uuid,uuid)','a17328f031853e4540e2260ac0b7b454'),
  ('public.get_enrollment_waitlist_v2(uuid)','ed9b8e591bf7b8871d121b7ec133eab1'),
  ('public.preview_waitlist_event_v2(uuid,uuid)','77a6b299b2b42c3f83e4d8162b9507ad'),
  ('public.set_enrollment_waitlist_v2(uuid,public.course_type,jsonb,boolean)','a10eb6271ed280588aeb3c03d621f130'),
  ('public.student_schedule_calendar_v2(uuid,uuid,date,text,integer)','a3f879d2f06120512f0e515525e7e0a1')
 ) v(sig,h) loop
  if to_regprocedure(g.sig) is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(g.sig)) is distinct from g.h then
   raise exception 'GUARDA_083: % no coincide con el cuerpo esperado; no se aplica la migración',g.sig;
  end if;
 end loop;
end $guard$;
-- GUARDA-MD5 FIN
alter table public.app_settings add column if not exists waitlist_expiry_days integer not null default 60 check(waitlist_expiry_days between 1 and 365), add column if not exists waitlist_daily_limit integer not null default 400 check(waitlist_daily_limit between 1 and 400);
alter table public.notifications add column if not exists waitlist_payload jsonb, add column if not exists waitlist_dispatch_day date;
-- Los avisos antiguos sin rangos demostrables no se envían como si fueran nuevos.
update public.notifications set email_status='fallido',email_last_error='ESPERA_REVISION_CONTRATO',email_lease_token=null,email_locked_until=null where tipo='espera_apertura' and email_status='pendiente';
drop index if exists public.notifications_waitlist_event;
create unique index if not exists notifications_waitlist_daily_queue on public.notifications(user_id,waitlist_event_day) where waitlist_payload is not null;
create unique index if not exists notifications_waitlist_daily_dispatch on public.notifications(user_id,waitlist_dispatch_day) where waitlist_dispatch_day is not null;
update public.users set enrollment_waitlist=coalesce((select jsonb_object_agg(k,v-'preference') from jsonb_each(enrollment_waitlist) x(k,v)),'{}');
create or replace function private.waitlist_eligible_v12(p_student uuid,p_type public.course_type) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.users u where u.id=p_student and u.rol='estudiante' and u.activo and u.enrollment_waitlist?p_type::text
 and (u.enrollment_waitlist->p_type::text->>'registeredAt')::timestamptz>private.cohortes_now()-make_interval(days=>coalesce((select waitlist_expiry_days from public.app_settings where id),60))
 and not exists(select 1 from public.enrollments e where e.student_id=u.id and e.course_type=p_type and e.status in('activo','finalizado'))
 and not exists(select 1 from public.student_schedule_reservations r where r.student_id=u.id and r.course_type=p_type and(r.estado='pago_en_curso' or(r.estado='vigente' and r.expira_at>private.cohortes_now()))))
$$;
create or replace function private.clean_waitlist_v12(p_student uuid default null) returns void language plpgsql security invoker set search_path='' as $$begin
 if not private.enrollment_rule_enabled('waitlist') then return;end if;
 update public.users u set enrollment_waitlist=coalesce((select jsonb_object_agg(k,v) from jsonb_each(u.enrollment_waitlist) x(k,v) where k in('A','B') and private.waitlist_eligible_v12(u.id,k::public.course_type)),'{}')
 where (p_student is null or u.id=p_student) and u.enrollment_waitlist<>'{}';
 update public.notifications n set email_status='fallido',email_last_error='ESPERA_RETIRO_SOLICITADO',email_lease_token=null,email_locked_until=null
 where n.tipo='espera_apertura' and n.email_status='pendiente' and(n.email_locked_until is null or n.email_locked_until<clock_timestamp()) and not exists(
 select 1 from jsonb_each(coalesce(n.waitlist_payload->'registrations','{}')) m(k,v) where private.waitlist_eligible_v12(n.user_id,k::public.course_type)
 and (select enrollment_waitlist->k->>'registrationId' from public.users where id=n.user_id)=v#>>'{}');
end $$;
create or replace function public.set_enrollment_waitlist_v2(p_student uuid,p_type public.course_type,p_preference jsonb default null,p_remove boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$declare entry jsonb;begin
 if not private.enrollment_rule_enabled('waitlist') then perform private.raise_cohort_error('ESPERA_REGLAS_INACTIVAS');end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then perform private.raise_cohort_error('ESPERA_CUENTA_NO_HABILITADA');end if;
 perform private.assert_student_not_deleting(p_student);
 if p_type is null or p_remove is null or p_preference is not null then perform private.raise_cohort_error('ESPERA_ENTRADA_INVALIDA');end if;
 perform private.clean_waitlist_v12(p_student);
 if p_remove then update public.users set enrollment_waitlist=enrollment_waitlist-p_type::text where id=p_student;
 else
 if exists(select 1 from public.enrollments where student_id=p_student and course_type=p_type and status in('activo','finalizado')) then perform private.raise_cohort_error('ESPERA_YA_MATRICULADO');end if;
 select enrollment_waitlist->p_type::text into entry from public.users where id=p_student;
 entry:=coalesce(entry,jsonb_build_object('registeredAt',private.cohortes_now(),'registrationId',gen_random_uuid()));
 update public.users set enrollment_waitlist=jsonb_set(enrollment_waitlist,array[p_type::text],entry) where id=p_student;
 end if;
 perform private.clean_waitlist_v12(p_student);
 return jsonb_build_object('registered',not p_remove,'registeredAt',entry->'registeredAt','expiresAt',(entry->>'registeredAt')::timestamptz+make_interval(days=>coalesce((select waitlist_expiry_days from public.app_settings where id),60)));
end $$;
create or replace function public.get_enrollment_waitlist_v2(p_student uuid) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if not private.enrollment_rule_enabled('waitlist') then return jsonb_build_object('active',false,'types','{}'::jsonb);end if;
 if not exists(select 1 from public.users where id=p_student and rol='estudiante' and activo) then perform private.raise_cohort_error('ESPERA_CUENTA_NO_HABILITADA');end if;
 perform private.clean_waitlist_v12(p_student);
 return jsonb_build_object('active',true,'expiryDays',(select waitlist_expiry_days from public.app_settings where id),'types',(select enrollment_waitlist from public.users where id=p_student),'enrollments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',course_type)),'[]') from public.enrollments where student_id=p_student and status in('activo','pendiente_cohorte')));
end $$;
-- Conjunto de inicios por constructor único. Sin almacenar horarios preferidos.
create or replace function private.waitlist_starts_v12(c public.cohorts) returns setof date language sql stable security invoker set search_path='' as $$
 select distinct d::date from generate_series(greatest(c.fecha_inicio_curso,(private.cohortes_now() at time zone 'America/Guayaquil')::date),c.fecha_fin_curso,interval '1 day') d
 cross join public.enrollment_plan_options o
 where c.habilitada and c.cancelled_at is null and o.habilitada and ((extract(isodow from d) in(6,7))=(o.modalidad='fin_de_semana'))
 and (private.enrollment_plan_v2(jsonb_build_object('fechaInicio',d::date,'modalidad',o.modalidad,'horasPorDia',o.horas_por_dia,'horaInicio',6))->>'ultimaFecha')::date<=c.fecha_fin_curso
 order by 1
$$;
create or replace function public.preview_waitlist_event_v2(p_actor uuid,p_cohort uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare c public.cohorts;oldc public.cohorts;v_type public.course_type;n integer:=0;expanded boolean:=false;ranges jsonb;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('waitlist') then return jsonb_build_object('count',0);end if;
 select * into c from public.cohorts where id=p_cohort;if not found then perform private.raise_cohort_error('COHORTE_NO_ENCONTRADA');end if;
 select tipo into v_type from public.courses where id=c.course_id;
 select (jsonb_populate_record(null::public.cohorts,a.old_value)).* into oldc from public.enrollment_domain_audit a where a.entity_type='cohort' and a.entity_id=c.id::text and a.action in('cohort_created','cohort_edited') order by a.created_at desc,a.id desc limit 1;
 expanded:=oldc.id is null or not coalesce((private.cohort_calendar_v2(oldc.fecha_inicio_matricula,oldc.fecha_fin_matricula,oldc.fecha_inicio_curso,oldc.fecha_fin_curso,oldc.habilitada,private.cohortes_now())->>'open')::boolean,false)
 or exists(select * from private.waitlist_starts_v12(c) except select * from private.waitlist_starts_v12(oldc));
 if expanded and private.waitlist_cohort_available_v2(c.id) then
 select count(*) into n from public.users u where private.waitlist_eligible_v12(u.id,v_type);
 ranges:=jsonb_build_array(jsonb_build_object('type',v_type,'from',c.fecha_inicio_curso,'to',c.fecha_fin_curso,'cutoff',c.fecha_fin_matricula-5));end if;
 return jsonb_build_object('count',n,'type',v_type,'day',(private.cohortes_now() at time zone 'America/Guayaquil')::date,'ranges',coalesce(ranges,'[]'));
end $$;
create or replace function public.enqueue_waitlist_event_v2(p_actor uuid,p_cohort uuid) returns integer language plpgsql security invoker set search_path='' as $$declare offer jsonb;v_type public.course_type;day date;u record;n integer:=0;msg text;payload jsonb;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('waitlist') then perform private.raise_cohort_error('ESPERA_REGLAS_INACTIVAS');end if;
 perform pg_advisory_xact_lock(hashtextextended('waitlist_dispatch',0));
 offer:=public.preview_waitlist_event_v2(p_actor,p_cohort);if coalesce((offer->>'count')::integer,0)=0 then return 0;end if;
 v_type:=(offer->>'type')::public.course_type;
 msg:='Se abrió un curso de tipo '||v_type::text||' con prácticas del '||(offer->'ranges'->0->>'from')||' al '||(offer->'ranges'->0->>'to')||'. Puedes inscribirte hasta el '||(offer->'ranges'->0->>'cutoff')||'. Entra a elegir tu horario. Sujeto a cupos disponibles.';
 for u in select * from public.users where private.waitlist_eligible_v12(id,v_type) order by(enrollment_waitlist->v_type::text->>'registeredAt')::timestamptz,id loop
 day:=(private.cohortes_now() at time zone 'America/Guayaquil')::date;
 if exists(select 1 from public.notifications where user_id=u.id and tipo='espera_apertura' and(email_status='enviado' and(created_at at time zone 'America/Guayaquil')::date=day or waitlist_dispatch_day=day)) then day:=day+1;end if;
 payload:=jsonb_build_object('ranges',offer->'ranges','registrations',jsonb_build_object(v_type::text,u.enrollment_waitlist->v_type::text->>'registrationId'));
 insert into public.notifications(user_id,tipo,titulo,mensaje,email_status,waitlist_type,waitlist_event_day,waitlist_registered_at,waitlist_registration_id,waitlist_payload,email_next_attempt_at)
 values(u.id,'espera_apertura','Hay cursos disponibles para tu inscripción',msg,'pendiente',v_type,day,(u.enrollment_waitlist->v_type::text->>'registeredAt')::timestamptz,(u.enrollment_waitlist->v_type::text->>'registrationId')::uuid,payload,greatest(clock_timestamp(),day::timestamp at time zone 'America/Guayaquil'))
 on conflict(user_id,waitlist_event_day) where waitlist_payload is not null do update set
 mensaje=case when position(excluded.mensaje in public.notifications.mensaje)>0 then public.notifications.mensaje else public.notifications.mensaje||E'\n'||excluded.mensaje end,
 waitlist_payload=jsonb_build_object('ranges',(select jsonb_agg(distinct value) from jsonb_array_elements((public.notifications.waitlist_payload->'ranges')||(excluded.waitlist_payload->'ranges'))),'registrations',(public.notifications.waitlist_payload->'registrations')||(excluded.waitlist_payload->'registrations'))
 where public.notifications.email_status='pendiente' and public.notifications.email_lease_token is null;
 n:=n+1;end loop;return n;
end $$;
-- Una sola confirmación retira únicamente las marcas anunciadas, sin quitar altas nuevas.
create or replace function private.waitlist_email_delivered_v2() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.tipo='espera_apertura' and new.email_status='enviado' and old.email_status is distinct from 'enviado' then
 update public.users u set enrollment_waitlist=coalesce((select jsonb_object_agg(k,v) from jsonb_each(u.enrollment_waitlist) m(k,v) where coalesce(new.waitlist_payload->'registrations'->>k,'')<>coalesce(v->>'registrationId','')),'{}') where u.id=new.user_id;
 end if;return new;end $$;
-- Reserva, matrícula o desactivación retiran marcas en la transacción de origen.
create or replace function private.waitlist_subject_changed_v12() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if not private.enrollment_rule_enabled('waitlist') then return new;end if;
 if tg_table_name='users' then
 if not new.activo then new.enrollment_waitlist:='{}';end if;return new;
 end if;
 perform private.clean_waitlist_v12(new.student_id);return new;
end $$;
create trigger users_waitlist_disabled_v12 before update of activo on public.users for each row execute function private.waitlist_subject_changed_v12();
create trigger reservations_waitlist_retired_v12 after insert or update of estado on public.student_schedule_reservations for each row execute function private.waitlist_subject_changed_v12();
create trigger enrollments_waitlist_retired_v12 after insert or update of status on public.enrollments for each row execute function private.waitlist_subject_changed_v12();
create or replace function public.claim_notification_email()
returns setof public.notifications language plpgsql volatile security invoker set search_path = '' as $$
declare v_id uuid; v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('waitlist_dispatch',0));
  perform private.clean_waitlist_v12();
  update public.notifications n set email_status = 'fallido', email_lease_token = null, email_locked_until = null,
    email_last_error = case when n.email_attempts >= 3 then 'No se pudo confirmar el envio tras tres intentos'
      when n.tipo = 'recordatorio_practica' and n.scheduled_at <= v_now then 'La práctica ya comenzó; no se envía un recordatorio tardío'
      when n.tipo = 'recordatorio_practica' and not exists(select 1 from public.practice_slots s
        where s.id=n.practice_slot_id and s.student_id=n.user_id and s.scheduled_at=n.scheduled_at
          and s.status in ('asignado','confirmado')) then 'La práctica cambió o ya no está asignada al destinatario'
      else 'Destinatario inactivo o inexistente' end
    where n.email_status = 'pendiente' and (n.email_locked_until is null or n.email_locked_until <= v_now)
      and (n.email_attempts >= 3 or (n.tipo = 'recordatorio_practica' and (n.scheduled_at <= v_now
        or not exists(select 1 from public.practice_slots s where s.id=n.practice_slot_id
          and s.student_id=n.user_id and s.scheduled_at=n.scheduled_at and s.status in ('asignado','confirmado'))))
        or not exists(select 1 from public.users u where u.id = n.user_id and u.activo));
  select n.id into v_id from public.notifications n
    where (n.tipo<>'espera_apertura' or(private.enrollment_rule_enabled('waitlist') and n.waitlist_payload is not null
      and not exists(select 1 from public.notifications sent where sent.user_id=n.user_id and sent.id<>n.id and sent.waitlist_dispatch_day=(private.cohortes_now() at time zone 'America/Guayaquil')::date)
      and (n.waitlist_dispatch_day=(private.cohortes_now() at time zone 'America/Guayaquil')::date or (select count(*) from public.notifications where waitlist_dispatch_day=(private.cohortes_now() at time zone 'America/Guayaquil')::date)<coalesce((select waitlist_daily_limit from public.app_settings where id),400))))
      and n.email_status = 'pendiente' and n.email_attempts < 3 and n.email_next_attempt_at <= v_now
      and (n.email_locked_until is null or n.email_locked_until <= v_now)
    order by coalesce(n.waitlist_registered_at,n.email_next_attempt_at), n.id for update skip locked limit 1;
  if not found then return; end if;
  return query update public.notifications set email_attempts = email_attempts + 1,
    waitlist_dispatch_day=case when tipo='espera_apertura' then(private.cohortes_now() at time zone 'America/Guayaquil')::date else waitlist_dispatch_day end,
    email_lease_token = gen_random_uuid(), email_locked_until = v_now + interval '2 minutes'
    where id = v_id returning *;
end;
$$;
-- La apertura futura genera una alerta administrativa, nunca un correo automático.
create or replace function public.maintain_waitlist_v12() returns void language plpgsql security invoker set search_path='' as $$declare c record;n integer;begin
 if not private.enrollment_rule_enabled('waitlist') then return;end if;perform private.clean_waitlist_v12();
 for c in select co.*,cu.tipo from public.cohorts co join public.courses cu on cu.id=co.course_id where co.habilitada and co.cancelled_at is null and co.fecha_inicio_matricula=(private.cohortes_now() at time zone 'America/Guayaquil')::date loop
 select count(*) into n from public.users where private.waitlist_eligible_v12(id,c.tipo);if n=0 then continue;end if;
 insert into public.notifications(user_id,tipo,titulo,mensaje,domain_code,domain_entity_id,domain_severity,domain_last_seen_at)
 select u.id,'cambio_realizado','Abrió un período de inscripción','Hay '||n||' esperando el tipo '||c.tipo||'. Revisa las fechas y confirma si deseas notificar.','ESPERA_APERTURA_FUTURA',c.id,'media',clock_timestamp()
 from public.users u join public.enrollment_admin_permissions a on a.admin_id=u.id and a.permission='manage_cohorts_prices' and a.revoked_at is null where u.rol='admin' and u.activo
 on conflict(user_id,domain_code,domain_entity_id) where domain_code is not null and domain_resolved_at is null do nothing;
 end loop;end $$;
do $$declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname like '%waitlist%v12') or(n.nspname='public' and p.proname='maintain_waitlist_v12') loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;end $$;
create or replace function public.schedule_unavailable_v12(p_student uuid,p_enrollment uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare e public.enrollments;c public.cohorts;plan jsonb;opened integer:=0;fits boolean:=false;last_start date;candidate date;begin
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student;
 if not found then perform private.raise_cohort_error('RESERVA_MATRICULA_AJENA');end if;
 if not private.enrollment_rule_enabled('date_rules') then return null;end if;
 plan:=private.enrollment_plan_v2(p_input);
 for c in select co.* from public.cohorts co join public.courses cu on cu.id=co.course_id where cu.tipo=e.course_type and co.habilitada and co.cancelled_at is null loop
 if not(private.cohort_calendar_v2(c.fecha_inicio_matricula,c.fecha_fin_matricula,c.fecha_inicio_curso,c.fecha_fin_curso,c.habilitada,private.cohortes_now())->>'open')::boolean then continue;end if;
 opened:=opened+1;
 if(plan->>'fechaInicioEfectiva')::date>=c.fecha_inicio_curso and(plan->>'ultimaFecha')::date<=c.fecha_fin_curso then fits:=true;end if;
 select max(d) into candidate from private.waitlist_starts_v12(c) d where ((extract(isodow from d) in(6,7))=(p_input->>'modalidad'='fin_de_semana')) and(private.enrollment_plan_v2(p_input||jsonb_build_object('fechaInicio',d))->>'ultimaFecha')::date<=c.fecha_fin_curso;
 last_start:=greatest(last_start,candidate);
 end loop;
 return jsonb_build_object('codigo',case when opened=0 then 'SIN_CURSOS_ABIERTOS' when not fits then 'SIN_FECHAS_COMPATIBLES' else 'SIN_HORAS_LIBRES' end,
 'mensaje',case when opened=0 then 'No hay cursos abiertos.' when not fits then 'Tus fechas no caben en el curso.'||case when last_start is null then '' else ' Última fecha de inicio posible: '||last_start::text||'.' end else 'No hay horas libres en esas fechas.' end,'primeraFechaPosible',null,'ultimaFechaInicioPosible',last_start);
end $$;
-- Completar motivos por día sin cambiar la decisión de disponibilidad.
do $$declare definition text;patched text;begin
 definition:=pg_get_functiondef('public.student_schedule_calendar_v2(uuid,uuid,date,text,integer)'::regprocedure);
 patched:=replace(definition,'conflict jsonb;begin','conflict jsonb;diagnostic jsonb;begin');
 patched:=replace(patched,'rows:=rows||jsonb_build_array', $body$diagnostic:=null;if not ok and conflict is null then diagnostic:=public.schedule_unavailable_v12(p_student,p_enrollment,jsonb_build_object('fechaInicio',d,'modalidad',p_mode,'horasPorDia',p_hours,'horaInicio',6));end if;
 rows:=rows||jsonb_build_array$body$);
 patched:=replace(patched,$old$conflict->>'message'$old$,$new$coalesce(conflict->>'message',diagnostic->>'mensaje')$new$);
 if patched=definition or position($chk$diagnostic->>'mensaje'$chk$ in patched)=0 then raise exception 'PARCHE_083_NO_APLICABLE: student_schedule_calendar_v2';end if;
 execute patched;
end $$;
revoke all on function public.schedule_unavailable_v12(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.schedule_unavailable_v12(uuid,uuid,jsonb) to service_role;
commit;
