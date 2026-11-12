-- L4: administración compatible. Aplicación manual; indicadores apagados.
begin;
set local lock_timeout='5s';
create or replace function private.cohort_name_key(p_name text) returns text language sql immutable security invoker set search_path='' as $$
 select regexp_replace(normalize(lower(btrim(p_name)),NFD),U&'[\0300-\036f]','','g')
$$;
create or replace function private.require_enrollment_permission(p_actor uuid,p_permission text) returns void
language plpgsql security invoker set search_path='' as $$ begin
 if not exists(select 1 from public.users u join public.enrollment_admin_permissions a on a.admin_id=u.id
  where u.id=p_actor and u.rol='admin' and u.activo and a.permission=p_permission and a.revoked_at is null) then
  perform private.raise_cohort_error('PERMISO_REQUERIDO');end if;
end $$;
grant insert on public.enrollment_domain_audit to service_role;
create or replace function private.cohort_admin_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare actor uuid;conflict_name text;occupied bigint;last_day date;begin
 if not private.enrollment_rule_enabled('cohort_admin') then return new;end if;
 actor:=nullif(current_setting('cohortes.actor',true),'')::uuid;
 perform private.require_enrollment_permission(actor,'manage_cohorts_prices');
 if tg_op='UPDATE' and private.cohortes_now()>=(old.fecha_fin_curso+1)::timestamp at time zone 'America/Guayaquil' then
  perform private.raise_cohort_error('COHORTE_TERMINADA');end if;
 perform private.cohort_calendar_v2(new.fecha_inicio_matricula,new.fecha_fin_matricula,new.fecha_inicio_curso,new.fecha_fin_curso,new.habilitada,private.cohortes_now());
 perform pg_advisory_xact_lock(hashtextextended('cohort_names_write',0));
 select nombre into conflict_name from public.cohorts where id<>new.id and private.cohort_name_key(nombre)=private.cohort_name_key(new.nombre) order by id limit 1;
 if found then perform private.raise_cohort_error('COHORTE_NOMBRE_DUPLICADO',jsonb_build_object('nombre',conflict_name));end if;
 if tg_op='INSERT' then
  new.codigo:='CD-'||upper(replace(new.id::text,'-',''));return new;
 end if;
 if exists(select 1 from public.enrollments where cohort_id=old.id) or exists(select 1 from public.student_schedule_reservations where cohort_id=old.id) then
  if new.fecha_inicio_curso<>old.fecha_inicio_curso or new.course_id<>old.course_id then perform private.raise_cohort_error('COHORTE_INICIO_INMUTABLE');end if;
  if new.codigo is distinct from old.codigo then perform private.raise_cohort_error('COHORTE_CODIGO_INMUTABLE');end if;
 end if;
 if new.fecha_fin_curso<old.fecha_fin_curso then
  if exists(select 1 from public.enrollments where cohort_id=old.id and status in ('activo','finalizado') and practice_end_date is null)
    or exists(select 1 from public.student_schedule_reservations where cohort_id=old.id and estado in ('vigente','pago_en_curso') and practice_end_date is null) then
    perform private.raise_cohort_error('CAPACIDAD_HISTORICO_PENDIENTE');end if;
  select max(d) into last_day from(
   select practice_end_date d from public.enrollments where cohort_id=old.id and status in ('activo','finalizado')
   union all select practice_end_date from public.student_schedule_reservations where cohort_id=old.id and(estado='pago_en_curso' or(estado='vigente' and expira_at>private.cohortes_now()))
  ) dates;
  if new.fecha_fin_curso<last_day then perform private.raise_cohort_error('COHORTE_FIN_CON_COMPROMISOS',jsonb_build_object('ultimoFin',last_day));end if;
 end if;
 if new.cupo_maximo<old.cupo_maximo then
  occupied:=private.cohort_peak_v2(old.id,new.fecha_inicio_curso,new.fecha_fin_curso);
  if occupied>new.cupo_maximo then perform private.raise_cohort_error('COHORTE_CUPO_INFERIOR',jsonb_build_object('ocupados',occupied));end if;
 end if;
 if new.cancelled_at is not null and old.cancelled_at is null and exists(select 1 from public.enrollments where cohort_id=old.id and status='activo') then
  perform private.raise_cohort_error('COHORTE_CANCELACION_BLOQUEADA');end if;
 return new;
end $$;
drop trigger if exists cohorts_00_admin_rules on public.cohorts;
create trigger cohorts_00_admin_rules before insert or update on public.cohorts for each row execute function private.cohort_admin_guard();
create or replace function private.cohort_admin_audit() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if private.enrollment_rule_enabled('cohort_admin') then
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
 values(nullif(current_setting('cohortes.actor',true),'')::uuid,case when tg_op='INSERT' then 'cohort_created' else 'cohort_edited' end,
 'cohort',new.id::text,case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new),coalesce(nullif(current_setting('cohortes.reason',true),''),'Edición administrativa'));
 end if;return new;end $$;
drop trigger if exists cohorts_admin_audit on public.cohorts;
create trigger cohorts_admin_audit after insert or update on public.cohorts for each row execute function private.cohort_admin_audit();

-- Las defensas heredadas se conservan en la rama apagada, sin aplicar su cupo
-- de toda la vida al intervalo individual nuevo.
alter function public.guard_cohort_reserved_capacity() rename to legacy073_guard_cohort_reserved_capacity;
create function public.guard_cohort_reserved_capacity() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('cohort_admin') and new.cupo_maximo<old.cupo_maximo and new.cupo_maximo<public.cohort_cupo_ocupado(old.id) then
 raise exception 'Cupo inferior a matrículas y reservas vigentes' using errcode='IC409';end if;return new;end $$;
drop trigger cohorts_reserved_capacity on public.cohorts;
create trigger cohorts_reserved_capacity before update of cupo_maximo on public.cohorts for each row execute function public.guard_cohort_reserved_capacity();
alter function public.guard_cohort_schedule_reservations() rename to legacy073_guard_cohort_schedule_reservations;
create function public.guard_cohort_schedule_reservations() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('cohort_admin') and exists(select 1 from public.student_schedule_reservations r join public.student_schedule_holds h on h.reservation_id=r.id
 where r.cohort_id=new.id and r.estado in ('vigente','pago_en_curso') and r.expira_at>clock_timestamp()
 and(new.course_id<>old.course_id or new.precio<>old.precio or(h.scheduled_at at time zone 'America/Guayaquil')::date<new.fecha_inicio_curso
 or(h.scheduled_at at time zone 'America/Guayaquil')::date>new.fecha_fin_curso-r.margen_dias)) then
 raise exception 'La cohorte tiene reservas vigentes; conserva curso, precio y fechas compatibles' using errcode='IR413';end if;return new;end $$;
drop trigger cohorts_schedule_reservations on public.cohorts;
create trigger cohorts_schedule_reservations before update of course_id,precio,fecha_inicio_curso,fecha_fin_curso on public.cohorts for each row execute function public.guard_cohort_schedule_reservations();

create or replace function public.write_cohort_v2(p_actor uuid,p_id uuid,p_version timestamptz,p_input jsonb,p_reason text)
returns public.cohorts language plpgsql security invoker set search_path='' as $$ declare c public.cohorts;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('cohort_admin') then perform private.raise_cohort_error('COHORTE_REGLAS_INACTIVAS');end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 or jsonb_typeof(p_input)<>'object' then perform private.raise_cohort_error('COHORTE_ENTRADA_INVALIDA');end if;
 perform set_config('cohortes.actor',p_actor::text,true);perform set_config('cohortes.reason',p_reason,true);
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in('courseId','nombre','precio','cupoMaximo','fechaInicioMatricula','fechaFinMatricula','fechaInicioCurso','fechaFinCurso','habilitada','tipoModalidad','horariosCapacitacionTeoria','numeroVehiculos','numeroAulas')) then perform private.raise_cohort_error('COHORTE_ENTRADA_INVALIDA');end if;
 if p_input?'courseId' and not exists(select 1 from public.courses where id=(p_input->>'courseId')::uuid) then perform private.raise_cohort_error('COHORTE_CURSO_NO_ENCONTRADO');end if;
 if p_id is null then
  insert into public.cohorts(course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso,habilitada,
   tipo_modalidad,horarios_capacitacion_teoria,numero_vehiculos,numero_aulas)
  values((p_input->>'courseId')::uuid,p_input->>'nombre',0,(p_input->>'cupoMaximo')::integer,
   private.lote1_date(p_input->>'fechaInicioMatricula'),private.lote1_date(p_input->>'fechaFinMatricula'),private.lote1_date(p_input->>'fechaInicioCurso'),private.lote1_date(p_input->>'fechaFinCurso'),
   coalesce((p_input->>'habilitada')::boolean,true),p_input->>'tipoModalidad',p_input->>'horariosCapacitacionTeoria',(p_input->>'numeroVehiculos')::integer,(p_input->>'numeroAulas')::integer) returning * into c;
 else
  select * into c from public.cohorts where id=p_id for update;
  if not found then perform private.raise_cohort_error('COHORTE_NO_ENCONTRADA');end if;
  if c.updated_at is distinct from p_version then perform private.raise_cohort_error('COHORTE_VERSION_CONFLICTO');end if;
  update public.cohorts set nombre=coalesce(p_input->>'nombre',nombre),course_id=coalesce((p_input->>'courseId')::uuid,course_id),
   cupo_maximo=coalesce((p_input->>'cupoMaximo')::integer,cupo_maximo),habilitada=coalesce((p_input->>'habilitada')::boolean,habilitada),
   fecha_inicio_matricula=coalesce(private.lote1_date(p_input->>'fechaInicioMatricula'),fecha_inicio_matricula),
   fecha_fin_matricula=coalesce(private.lote1_date(p_input->>'fechaFinMatricula'),fecha_fin_matricula),
   fecha_inicio_curso=coalesce(private.lote1_date(p_input->>'fechaInicioCurso'),fecha_inicio_curso),
   fecha_fin_curso=coalesce(private.lote1_date(p_input->>'fechaFinCurso'),fecha_fin_curso),
   tipo_modalidad=case when p_input?'tipoModalidad' then p_input->>'tipoModalidad' else tipo_modalidad end,
   horarios_capacitacion_teoria=case when p_input?'horariosCapacitacionTeoria' then p_input->>'horariosCapacitacionTeoria' else horarios_capacitacion_teoria end,
   numero_vehiculos=case when p_input?'numeroVehiculos' then(p_input->>'numeroVehiculos')::integer else numero_vehiculos end,
   numero_aulas=case when p_input?'numeroAulas' then(p_input->>'numeroAulas')::integer else numero_aulas end
   where id=p_id returning * into c;
 end if;return c;
exception when invalid_text_representation or numeric_value_out_of_range then perform private.raise_cohort_error('COHORTE_ENTRADA_INVALIDA');
end $$;

create or replace function public.set_course_type_price_v2(p_actor uuid,p_type public.course_type,p_cents bigint,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$ declare before jsonb;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('prices') then perform private.raise_cohort_error('COHORTE_REGLAS_INACTIVAS');end if;
 if p_cents is null or p_cents not between 0 and 999999 or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then perform private.raise_cohort_error('PAGO_PRECIO_INVALIDO');end if;
 perform pg_advisory_xact_lock(hashtextextended('course_price_'||p_type::text,0));
 select to_jsonb(p) into before from public.course_type_prices p where tipo=p_type for update;
 if not found then perform private.raise_cohort_error('PAGO_PRECIO_CARGA_INICIAL');end if;
 insert into public.course_type_prices(tipo,precio_centavos,updated_by,motivo) values(p_type,p_cents,p_actor,p_reason)
 on conflict(tipo) do update set precio_centavos=excluded.precio_centavos,updated_by=excluded.updated_by,motivo=excluded.motivo,updated_at=clock_timestamp();
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
 values(p_actor,'price_changed','course_type',p_type::text,before,jsonb_build_object('precio_centavos',p_cents),p_reason);
end $$;

create or replace function public.set_vehicle_capacity_v2(p_actor uuid,p_count integer,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare old_count integer;hours integer;begin
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 if not private.enrollment_rule_enabled('capacity') then perform private.raise_cohort_error('COHORTE_REGLAS_INACTIVAS');end if;
 if p_count is null or p_count not between 0 and 1000 or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then perform private.raise_cohort_error('CAPACIDAD_ENTRADA_INVALIDA');end if;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 select vehiculos_disponibles into old_count from public.app_settings where id for update;
 update public.app_settings set vehiculos_disponibles=p_count,updated_by=p_actor,updated_at=clock_timestamp() where id;
 select count(*) into hours from(select distinct scheduled_at from public.practice_slots where student_id is not null and status in ('asignado','confirmado') and scheduled_at>private.cohortes_now()) t
 where private.vehicle_occupation_v2(t.scheduled_at)>p_count;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
 values(p_actor,'vehicle_capacity_changed','settings','global',jsonb_build_object('vehiculos',old_count),jsonb_build_object('vehiculos',p_count,'horasSobreLimite',hours),p_reason);
 -- Aviso en la bandeja administrativa existente; ninguna práctica se modifica.
 update public.notifications set domain_resolved_at=clock_timestamp() where domain_code='CAPACIDAD_HORAS_SOBRE_LIMITE' and domain_resolved_at is null and hours=0;
 if hours>0 then
 insert into public.notifications(user_id,tipo,titulo,mensaje,domain_code,domain_entity_id,domain_severity,domain_last_seen_at)
 select u.id,'cambio_realizado','Capacidad de vehículos',hours::text||' horas exceden el límite. Reasignar horarios o revisar la disponibilidad; las prácticas se conservan.',
 'CAPACIDAD_HORAS_SOBRE_LIMITE','00000000-0000-0000-0000-000000000001'::uuid,'alta',clock_timestamp()
 from public.users u join public.enrollment_admin_permissions a on a.admin_id=u.id and a.permission='manage_cohorts_prices' and a.revoked_at is null where u.activo and u.rol='admin'
 on conflict(user_id,domain_code,domain_entity_id) where domain_code is not null and domain_resolved_at is null do update set mensaje=excluded.mensaje,domain_last_seen_at=excluded.domain_last_seen_at;
 end if;return jsonb_build_object('vehiculos',p_count,'horasSobreLimite',hours);
end $$;
create or replace function public.cohort_admin_config_v2(p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 if not private.enrollment_rule_enabled('cohort_admin') then return jsonb_build_object('active',false);end if;
 perform private.require_enrollment_permission(p_actor,'manage_cohorts_prices');
 return jsonb_build_object('active',true,'serverNow',private.cohortes_now(),'vehiculos',(select vehiculos_disponibles from public.app_settings where id),
 'prices',(select coalesce(jsonb_agg(jsonb_build_object('tipo',tipo,'centavos',precio_centavos) order by tipo),'[]') from public.course_type_prices),
 'pricesActive',private.enrollment_rule_enabled('prices'),'capacityActive',private.enrollment_rule_enabled('capacity'));
end $$;
revoke all on function public.cohort_admin_config_v2(uuid) from public,anon,authenticated;
grant execute on function public.cohort_admin_config_v2(uuid) to service_role;
grant insert,update on public.course_type_prices to service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in ('cohort_name_key','require_enrollment_permission','cohort_admin_guard','cohort_admin_audit'))
 or(n.nspname='public' and p.proname in ('write_cohort_v2','set_course_type_price_v2','set_vehicle_capacity_v2','guard_cohort_reserved_capacity','guard_cohort_schedule_reservations','legacy073_guard_cohort_reserved_capacity','legacy073_guard_cohort_schedule_reservations')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
update public.enrollment_rule_flags set implemented=true,enabled=false where key='cohort_admin';
notify pgrst,'reload schema';
commit;
