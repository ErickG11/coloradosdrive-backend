-- L12d C -> A -> B. Sin activación automática; auditoría en el mecanismo existente.
begin;
set local lock_timeout='5s';
-- GUARDA-MD5 INICIO (hash congelado de la instalación local; md5(replace(prosrc,chr(13),'')))
do $guard$declare g record;begin
 for g in select * from (values
  ('private.cohort_admin_guard()','c47edcf1bc0cf6e0d6e106af3ef4cc5d'),
  ('private.integrated_manual_commit_v2(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamp with time zone[],uuid,jsonb,jsonb)','5343364b66d6112baf38f319a077d64f'),
  ('private.integrated_manual_details_v2(uuid,uuid,jsonb,jsonb)','c10f66a211e2f3d01accda0f25a842dd'),
  ('private.practice_replacement_balance(uuid)','47f323f017e56b147f78031f1d93fd4e')
 ) v(sig,h) loop
  if to_regprocedure(g.sig) is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(g.sig)) is distinct from g.h then
   raise exception 'GUARDA_084: % no coincide con el cuerpo esperado; no se aplica la migración',g.sig;
  end if;
 end loop;
end $guard$;
-- GUARDA-MD5 FIN
create or replace function public.set_enrollment_document_v12(p_actor uuid,p_student uuid,p_enrollment uuid,p_type text,p_status text,p_expected text) returns jsonb language plpgsql security invoker set search_path='' as $$declare previous public.enrollment_documents;begin
 perform private.require_enrollment_permission(p_actor,'verify_identity');
 if not private.enrollment_rule_enabled('identity') then perform private.raise_cohort_error('IDENTIDAD_REGLAS_INACTIVAS');end if;
 perform 1 from public.users where id=p_student and rol='estudiante' for update;
 if not found then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 perform private.assert_student_not_deleting(p_student);
 if not exists(select 1 from public.enrollments where id=p_enrollment and student_id=p_student) then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 if p_type is null or p_type not in('cedula','papeleta_votacion','tipo_sangre','titulo_bachiller') or p_status is null or p_status not in('pendiente','entregado','no_aplica') then perform private.raise_cohort_error('DOCUMENTO_ESTADO_INVALIDO');end if;
 select * into previous from public.enrollment_documents where enrollment_id=p_enrollment and tipo=p_type for update;
 if previous.estado is distinct from p_expected then perform private.raise_cohort_error('DOCUMENTO_VERSION_CONFLICTO');end if;
 insert into public.enrollment_documents(enrollment_id,tipo,estado,marcado_por,fecha_marcado) values(p_enrollment,p_type,p_status,p_actor,clock_timestamp())
 on conflict(enrollment_id,tipo) do update set estado=excluded.estado,marcado_por=excluded.marcado_por,fecha_marcado=excluded.fecha_marcado;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason) values(p_actor,'document_checklist_changed','enrollment',p_enrollment::text,to_jsonb(previous),jsonb_build_object('tipo',p_type,'estado',p_status,'marcado_por',p_actor,'fecha_marcado',clock_timestamp()),'Decisión explícita del administrador');
 return jsonb_build_object('type',p_type,'status',p_status);
end $$;
create or replace function pg_temp.patch_fn(p_sig regprocedure,p_old text,p_new text) returns void language plpgsql as $f$declare d text;begin
 d:=pg_get_functiondef(p_sig);
 if position(p_old in d)=0 then raise exception 'PARCHE_084_NO_APLICABLE: % no contiene el fragmento esperado',p_sig;end if;
 execute replace(d,p_old,p_new);end $f$;
-- Una decisión explícita sobre papeleta prevalece sobre el valor inicial por edad.
do $$begin
 perform pg_temp.patch_fn('private.integrated_manual_details_v2(uuid,uuid,jsonb,jsonb)'::regprocedure,'if v_senior and v_type=''papeleta_votacion'' then v_status := ''no_aplica''; end if;','');
 perform pg_temp.patch_fn('private.integrated_manual_details_v2(uuid,uuid,jsonb,jsonb)'::regprocedure,'case when v_senior and v_type=''papeleta_votacion'' then null else clock_timestamp() end','clock_timestamp()');
 perform pg_temp.patch_fn('private.integrated_manual_details_v2(uuid,uuid,jsonb,jsonb)'::regprocedure,'case when v_senior and v_type=''papeleta_votacion'' then null else p_actor end','p_actor');
end $$;
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.integrated_manual_commit_v2(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,'if v_senior and v_document_type = ''papeleta_votacion'' then v_status := ''no_aplica''; end if;','');
 definition:=regexp_replace(definition,'fecha_marcado=case when v_status <> ''pendiente'' and not \(v_senior and v_document_type=''papeleta_votacion''\)\s+then clock_timestamp\(\) else null end','fecha_marcado=clock_timestamp()');
 definition:=regexp_replace(definition,'marcado_por=case when v_status <> ''pendiente'' and not \(v_senior and v_document_type=''papeleta_votacion''\)\s+then op.actor_id else null end','marcado_por=op.actor_id');
 if definition ~ 'v_senior and v_document_type' then raise exception 'PARCHE_084_NO_APLICABLE: integrated_manual_commit_v2 conserva la exención por edad';end if;
 execute definition;
end $$;
-- Mensaje de acortamiento: número de compromisos y fecha máxima demostrable.
do $$begin
 perform pg_temp.patch_fn('private.cohort_admin_guard()'::regprocedure,'jsonb_build_object(''ultimoFin'',last_day)','jsonb_build_object(''ultimoFin'',last_day,''cantidad'',(select count(*) from(select id from public.enrollments where cohort_id=old.id and status in(''activo'',''finalizado'') and practice_end_date>new.fecha_fin_curso union all select id from public.student_schedule_reservations where cohort_id=old.id and (estado=''pago_en_curso'' or(estado=''vigente'' and expira_at>private.cohortes_now())) and practice_end_date>new.fecha_fin_curso) commitments))');

 perform pg_temp.patch_fn('private.cohort_admin_guard()'::regprocedure,' perform private.cohort_calendar_v2(new.fecha_inicio_matricula',' if new.fecha_fin_matricula>new.fecha_fin_curso and new.fecha_fin_matricula>=new.fecha_inicio_matricula then perform private.raise_cohort_error(''COHORTE_MATRICULA_FUERA_DE_CURSO'');end if;
 perform private.cohort_calendar_v2(new.fecha_inicio_matricula');
end $$;
create or replace function public.admin_enrollment_management_v12(p_actor uuid,p_student uuid,p_enrollment uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare e public.enrollments;destinations jsonb;begin
 if not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then perform private.raise_cohort_error('PERMISO_REQUERIDO');end if;
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student;if not found then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 if private.enrollment_rule_enabled('schedule_changes') and exists(select 1 from public.enrollment_admin_permissions where admin_id=p_actor and permission='reassign_schedules' and revoked_at is null) then
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.nombre,'from',c.fecha_inicio_curso,'to',c.fecha_fin_curso,'capacity',c.cupo_maximo,'occupied',private.cohort_peak_v2(c.id,coalesce(e.practice_start_date,c.fecha_inicio_curso),coalesce(e.practice_end_date,c.fecha_fin_curso),e.id),
 'fits',e.practice_start_date>=c.fecha_inicio_curso and e.practice_end_date<=c.fecha_fin_curso,
 'reason',case when private.cohortes_now()>=(c.fecha_fin_curso+1)::timestamp at time zone 'America/Guayaquil' then 'El destino está terminado.' when not c.habilitada or c.cancelled_at is not null then 'El destino no está habilitado.' when e.practice_start_date is null or e.practice_end_date is null then 'Faltan fechas individuales demostrables; resolver preflight.' when e.practice_start_date<c.fecha_inicio_curso or e.practice_end_date>c.fecha_fin_curso then 'El plan no cabe; requiere excepción explícita y motivo.' when not(private.cohort_calendar_v2(c.fecha_inicio_matricula,c.fecha_fin_matricula,c.fecha_inicio_curso,c.fecha_fin_curso,c.habilitada,private.cohortes_now())->>'open')::boolean then 'La matrícula está cerrada; requiere excepción explícita y motivo.' when private.cohort_peak_v2(c.id,e.practice_start_date,e.practice_end_date,e.id)>=c.cupo_maximo then 'Sin cupo en el intervalo del alumno.' else 'El plan cabe.' end) order by c.fecha_inicio_curso,c.id),'[]') into destinations
 from public.cohorts c join public.courses cu on cu.id=c.course_id where cu.tipo=e.course_type;
 end if;
 return jsonb_build_object('version',e.updated_at,'documentsEnabled',private.enrollment_rule_enabled('identity') and exists(select 1 from public.enrollment_admin_permissions where admin_id=p_actor and permission='verify_identity' and revoked_at is null),
 'transferEnabled',private.enrollment_rule_enabled('schedule_changes') and(e.origen='manual' or e.etapa_inscripcion='activa') and e.status in('activo','pendiente_cohorte'),'destinations',coalesce(destinations,'[]'));
end $$;
create or replace function public.transfer_enrollment_cohort_v12(p_actor uuid,p_student uuid,p_enrollment uuid,p_target uuid,p_version timestamptz,p_reason text,p_exception boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$declare e public.enrollments;c public.cohorts;old_cohort uuid;historical jsonb;future_slots timestamptz[];begin
 perform private.require_enrollment_permission(p_actor,'reassign_schedules');
 if not private.enrollment_rule_enabled('schedule_changes') then perform private.raise_cohort_error('PLAN_CAMBIO_REGLAS_INACTIVAS');end if;
 if p_exception is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then perform private.raise_cohort_error('PLAN_REASIGNACION_ENTRADA_INVALIDA');end if;
 perform private.lock_student_schedule_v12(p_student);
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;if not found then perform private.raise_cohort_error('RESERVA_CUENTA_NO_HABILITADA');end if;perform private.assert_student_not_deleting(p_student);
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student for update;if not found then perform private.raise_cohort_error('MATRICULA_NO_ENCONTRADA');end if;
 if e.updated_at is distinct from p_version then perform private.raise_cohort_error('PLAN_CAMBIO_VERSION_CONFLICTO');end if;
 if e.status not in('activo','pendiente_cohorte') or(e.origen<>'manual' and e.etapa_inscripcion<>'activa') then perform private.raise_cohort_error('RESERVA_ESTADO_NO_PERMITIDO');end if;
 if e.practice_start_date is null or e.practice_end_date is null then perform private.raise_cohort_error('CAPACIDAD_HISTORICO_PENDIENTE');end if;
 if exists(select 1 from public.student_schedule_reservations where student_id=p_student and (enrollment_id=e.id or replacement_enrollment_id=e.id) and(estado='pago_en_curso' or(estado='vigente' and expira_at>private.cohortes_now()))) then perform private.raise_cohort_error('MATRICULA_RESERVA_EN_CURSO');end if;
 perform 1 from public.cohorts where id in(e.cohort_id,p_target) order by id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 select * into c from public.cohorts where id=p_target;if not found then perform private.raise_cohort_error('COHORTE_NO_ENCONTRADA');end if;
 if c.id=e.cohort_id then return jsonb_build_object('changed',false);end if;
 if (select tipo from public.courses where id=c.course_id)<>e.course_type then perform private.raise_cohort_error('COHORTE_TIPO_INCOMPATIBLE');end if;
 if not c.habilitada or c.cancelled_at is not null or private.cohortes_now()>=(c.fecha_fin_curso+1)::timestamp at time zone 'America/Guayaquil' then perform private.raise_cohort_error('COHORTE_TERMINADA');end if;
 if (e.practice_start_date<c.fecha_inicio_curso or e.practice_end_date>c.fecha_fin_curso or not(private.cohort_calendar_v2(c.fecha_inicio_matricula,c.fecha_fin_matricula,c.fecha_inicio_curso,c.fecha_fin_curso,c.habilitada,private.cohortes_now())->>'open')::boolean) and not p_exception then perform private.raise_cohort_error('COHORTE_EXCEPCION_REQUERIDA');end if;
 if private.cohort_peak_v2(c.id,e.practice_start_date,e.practice_end_date,e.id)>=c.cupo_maximo then perform private.raise_cohort_error('RESERVA_RECURSO_OCUPADO');end if;
 old_cohort:=e.cohort_id;
 select coalesce(jsonb_agg(distinct value),'[]') into historical from (
 select value from jsonb_array_elements(coalesce(e.practice_plan->'historicalSlotIds','[]'))
 union select to_jsonb(id::text) from public.practice_slots where student_id=p_student and cohort_id=e.cohort_id and (status='completado' or scheduled_at<=private.cohortes_now())) previous_slots;
 select array_agg(scheduled_at) into future_slots from public.practice_slots where student_id=p_student and cohort_id=e.cohort_id and status in('asignado','confirmado') and scheduled_at>private.cohortes_now();
 -- No cambia instantes ni instructores; conserva la exclusión y sus prácticas históricas.
 update public.practice_slots set cohort_id=c.id where student_id=p_student and cohort_id=e.cohort_id and status in('asignado','confirmado') and scheduled_at>private.cohortes_now();
 update public.enrollments set cohort_id=c.id,course_id=c.course_id,status='activo',practice_plan=coalesce(practice_plan,'{}')||jsonb_build_object('historicalSlotIds',historical),
 monto_total=coalesce(monto_total,(select precio_centavos/100.0 from public.course_type_prices where tipo=e.course_type)-descuento) where id=e.id;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason) values(p_actor,'enrollment_cohort_transferred','enrollment',e.id::text,jsonb_build_object('cohortId',old_cohort),jsonb_build_object('cohortId',c.id,'exception',p_exception,'practiceStart',e.practice_start_date,'practiceEnd',e.practice_end_date),p_reason);
 insert into public.notifications(user_id,tipo,titulo,mensaje,email_status,email_next_attempt_at) values(p_student,'plan_cambiado','Actualización de inscripción','Tus prácticas se mantienen del '||e.practice_start_date||' al '||e.practice_end_date||'. Conservas tus horarios, pagos y acceso.','pendiente',clock_timestamp());
 return jsonb_build_object('changed',true,'enrollmentId',e.id);
end $$;
-- Las horas ya realizadas siguen contando aunque pertenezcan a la cohorte anterior.
do $$begin
 perform pg_temp.patch_fn('private.practice_replacement_balance(uuid)'::regprocedure,'s.student_id = e.student_id and s.cohort_id = e.cohort_id','s.student_id = e.student_id and (s.cohort_id = e.cohort_id or coalesce(e.practice_plan->''historicalSlotIds'',''[]''::jsonb)?s.id::text)');
end $$;
do $$declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('set_enrollment_document_v12','admin_enrollment_management_v12','transfer_enrollment_cohort_v12') loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;end $$;
commit;
