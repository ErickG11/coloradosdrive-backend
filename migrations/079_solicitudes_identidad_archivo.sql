-- L9. Revisión exclusiva, evidencia presencial y archivo enlazado. Sin borrado de aprobaciones.
begin;
set local lock_timeout='5s';
alter table public.app_settings add column if not exists solicitud_retention_policy jsonb not null default
 '{"borradorDias":7,"devueltaDias":15,"certificadoVerificadoDias":30,"huerfanoDias":1,"rechazadaDias":null,"aprobadaDias":null,"archivadaDias":null}'::jsonb,
 add column if not exists solicitud_review_minutes integer not null default 5 check(solicitud_review_minutes between 1 and 60);
-- null rechazadaDias hereda SOLICITUD_RETENCION_DIAS vigente; aprobada/archivada nunca se eliminan.
alter table public.solicitudes_inscripcion add column if not exists updated_at timestamptz not null default clock_timestamp(),
 add column if not exists archived_at timestamptz,
 add column if not exists linked_enrollment_id uuid references public.enrollments(id) on delete restrict,
 add column if not exists review_owner uuid,add column if not exists review_token uuid,add column if not exists review_until timestamptz,
 add column if not exists revoked_at timestamptz,add column if not exists revoked_by uuid,add column if not exists revocation_reason text,
 add column if not exists revocation_payment_review boolean not null default false;
alter table public.users add column if not exists identity_access_blocked_at timestamptz;
drop index if exists public.solicitudes_cedula_activa_unique;
create unique index solicitudes_cedula_activa_unique on public.solicitudes_inscripcion(cedula) where cedula is not null and estado in('enviada','devuelta','aprobada','archivada');
alter table public.solicitudes_inscripcion drop constraint solicitudes_estado_valido;
alter table public.solicitudes_inscripcion add constraint solicitudes_estado_valido check(estado in('borrador','enviada','devuelta','aprobada','rechazada','archivada'));
alter table public.solicitud_verificaciones add column if not exists mode text,
 add column if not exists scan_path text,add column if not exists scan_mime text,add column if not exists scan_sha256 text,
 add column if not exists scan_size integer,add column if not exists scan_deleted_at timestamptz;
alter table public.solicitud_verificaciones drop constraint if exists verification_mode_shape;
alter table public.solicitud_verificaciones drop constraint if exists verification_physical_scan;
alter table public.solicitud_verificaciones add constraint verification_mode_shape check(mode is null or mode in('web','presencial','documento_homologado')),
 add constraint verification_physical_scan check(mode is distinct from 'presencial' or(scan_path is not null and scan_sha256~'^[a-f0-9]{64}$' and scan_size between 1 and 2097152));
alter table public.solicitud_auditoria add column if not exists email_kind text,
 add column if not exists email_state text check(email_state in('queued','processing','sent','failed')),
 add column if not exists email_attempts integer not null default 0,add column if not exists email_token uuid,
 add column if not exists email_lease_until timestamptz,add column if not exists email_next_at timestamptz;
grant update(email_state,email_attempts,email_token,email_lease_until,email_next_at) on public.solicitud_auditoria to service_role;
grant update(scan_deleted_at) on public.solicitud_verificaciones to service_role;
create index if not exists solicitud_email_queue on public.solicitud_auditoria(email_next_at,creado_at) where email_state in('queued','processing','failed');
create or replace function private.touch_request_version_v2() returns trigger language plpgsql security invoker set search_path='' as $$begin new.updated_at:=clock_timestamp();return new;end $$;
drop trigger if exists request_touch_version on public.solicitudes_inscripcion;
create trigger request_touch_version before update on public.solicitudes_inscripcion for each row execute function private.touch_request_version_v2();
-- Ampliación de transición revisada, conservando literalmente todas las guardas anteriores.
do $$declare def text;begin
 if to_regprocedure('public.legacy079_protect_solicitud_date()') is null then
  def:=pg_get_functiondef('public.protect_solicitud_date()'::regprocedure);
  if position('(old.estado = ''devuelta'' and new.estado in (''enviada'',''rechazada''))' in def)=0 then raise exception 'Guarda distinta: revisar 079';end if;
  execute 'alter function public.protect_solicitud_date() rename to legacy079_protect_solicitud_date';
  def:=replace(def,'(old.estado = ''devuelta'' and new.estado in (''enviada'',''rechazada''))',
    '(old.estado = ''devuelta'' and new.estado in (''enviada'',''rechazada'')) or (old.estado=''aprobada'' and new.estado=''archivada'' and new.student_id is not null)');execute def;
  drop trigger solicitudes_fecha_inmutable on public.solicitudes_inscripcion;
  create trigger solicitudes_fecha_inmutable before insert or update on public.solicitudes_inscripcion for each row execute function public.protect_solicitud_date();
 end if;
end $$;
-- Las únicas funciones sustituidas se guardan para el rollback funcional.
do $$declare r record;begin for r in select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in('registrar_verificacion_inscripcion','reclamar_aprobacion_inscripcion','finalizar_aprobacion_inscripcion','devolver_solicitud_inscripcion','rechazar_solicitud_inscripcion','listar_solicitudes_admin','impedir_cambio_verificacion','listar_objetos_huerfanos_solicitudes') loop
 if not exists(select 1 from pg_proc b join pg_namespace bn on bn.oid=b.pronamespace where bn.nspname='public' and b.proname='legacy079_'||r.proname) then execute format('alter function public.%I(%s) rename to %I',r.proname,r.args,'legacy079_'||r.proname);end if;end loop;end $$;
create or replace function private.identity_alert_v2(p_code text,p_entity uuid,p_message text,p_resolved boolean default false) returns void language plpgsql security invoker set search_path='' as $$begin
 if p_resolved then update public.notifications set domain_resolved_at=clock_timestamp() where domain_code=p_code and domain_entity_id=p_entity and domain_resolved_at is null;return;end if;
 insert into public.notifications(user_id,tipo,titulo,mensaje,domain_code,domain_entity_id,domain_severity,domain_last_seen_at)
 select u.id,'cambio_realizado',p_code,p_message,p_code,p_entity,'alta',clock_timestamp() from public.users u join public.enrollment_admin_permissions a on a.admin_id=u.id and a.permission='verify_identity' and a.revoked_at is null where u.rol='admin' and u.activo
 on conflict(user_id,domain_code,domain_entity_id) where domain_code is not null and domain_resolved_at is null do update set domain_last_seen_at=excluded.domain_last_seen_at,
 read_at=case when public.notifications.domain_last_seen_at<clock_timestamp()-interval '1 day' then null else public.notifications.read_at end;
end $$;
create or replace function private.require_request_review_v2(p_id uuid,p_actor uuid,p_token uuid default null) returns void language plpgsql security invoker set search_path='' as $$declare s public.solicitudes_inscripcion;begin
 perform private.require_enrollment_permission(p_actor,'verify_identity');
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found or s.estado='borrador' then perform private.raise_cohort_error('SOLICITUD_NO_ENCONTRADA');end if;
 if s.estado<>'enviada' or s.reviewed_at is not null then perform private.raise_cohort_error('SOLICITUD_ESTADO_INVALIDO');end if;
 if s.review_owner is distinct from p_actor or s.review_until is null or s.review_until<=private.cohortes_now() or(p_token is not null and s.review_token is distinct from p_token) then perform private.raise_cohort_error('SOLICITUD_REVISION_REQUERIDA');end if;
end $$;
create or replace function public.request_review_v2(p_actor uuid,p_id uuid,p_claim boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$declare s public.solicitudes_inscripcion;minutes integer;begin
 perform private.require_enrollment_permission(p_actor,'verify_identity');
 if not private.enrollment_rule_enabled('identity') then return jsonb_build_object('active',false);end if;
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found or s.estado='borrador' then perform private.raise_cohort_error('SOLICITUD_NO_ENCONTRADA');end if;
 if p_claim then
  if s.estado<>'enviada' or s.reviewed_at is not null then perform private.raise_cohort_error('SOLICITUD_ESTADO_INVALIDO');end if;
  if s.review_until>private.cohortes_now() and s.review_owner is distinct from p_actor then perform private.raise_cohort_error('SOLICITUD_REVISION_OCUPADA');end if;
  select solicitud_review_minutes into minutes from public.app_settings where id;
  update public.solicitudes_inscripcion set review_owner=p_actor,review_token=case when review_owner=p_actor and review_until>private.cohortes_now() then review_token else gen_random_uuid() end,review_until=private.cohortes_now()+make_interval(mins=>minutes) where id=p_id returning * into s;
 end if;
 return jsonb_build_object('active',true,'serverNow',private.cohortes_now(),'owned',s.review_owner=p_actor and s.review_until>private.cohortes_now(),'token',case when s.review_owner=p_actor then s.review_token end,'until',s.review_until,
 'failedEmails',(select count(*) from public.solicitud_auditoria where solicitud_id=p_id and email_state='failed' and email_attempts>=3),'updatedAt',s.updated_at,'archivedAt',s.archived_at,'studentId',s.student_id,'enrollmentId',s.linked_enrollment_id,'revokedAt',s.revoked_at,'paymentReview',s.revocation_payment_review);
end $$;
create or replace function public.registrar_verificacion_inscripcion(p_id uuid,p_actor uuid,p_tipo text,p_metodo text,p_resultado text,p_nota text,p_habilita boolean) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('identity') then perform private.raise_cohort_error('SOLICITUD_VERIFICACION_ACTUALIZAR');end if;
 return public.legacy079_registrar_verificacion_inscripcion(p_id,p_actor,p_tipo,p_metodo,p_resultado,p_nota,p_habilita);
end $$;
create or replace function public.register_request_verification_v2(p_actor uuid,p_id uuid,p_token uuid,p_type text,p_method text,p_result text,p_note text,p_mode text,p_scan jsonb default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_inscripcion;v public.solicitud_verificaciones;begin
 if not private.enrollment_rule_enabled('identity') then perform private.raise_cohort_error('SOLICITUD_REGLAS_INACTIVAS');end if;
 perform private.require_request_review_v2(p_id,p_actor,p_token);
 if p_token is null or p_type not in('identidad','estudios') or p_type is null or p_result not in('verificado','no_coincide','no_encontrado') or p_result is null
  or p_method not in('registro_civil_portal','registro_civil_web_service','ministerio_portal','codigo_qr_certificado','llamada_institucion','original_presencial','revision_visual') or p_method is null
  or p_mode not in('web','presencial','documento_homologado') or p_mode is null or length(btrim(coalesce(p_note,''))) not between 1 and 1000 then perform private.raise_cohort_error('SOLICITUD_VERIFICACION_INVALIDA');end if;
 if (p_method='original_presencial') is distinct from(p_mode='presencial') then perform private.raise_cohort_error('SOLICITUD_VERIFICACION_INVALIDA');end if;
 select * into s from public.solicitudes_inscripcion where id=p_id;
 if not s.correo_verificado or s.datos_actualizados_at is null or s.nivel_estudios is null then perform private.raise_cohort_error('SOLICITUD_ESTADO_INVALIDO');end if;
 if p_mode='documento_homologado' and not exists(select 1 from public.solicitud_documentos where solicitud_id=p_id and tipo_documento='certificado_estudios' and subtipo='resolucion_homologacion' and storage_path is not null) then perform private.raise_cohort_error('SOLICITUD_HOMOLOGACION_REQUERIDA');end if;
 if p_mode='presencial' then
  if p_scan is null or coalesce(p_scan->>'path','') !~ ('^solicitudes/'||p_id::text||'/verificacion/[a-f0-9-]{36}\.(pdf|jpg|png)$')
   or coalesce(p_scan->>'mime','') not in('application/pdf','image/jpeg','image/png') or coalesce(p_scan->>'sha256','')!~'^[a-f0-9]{64}$'
   or coalesce(p_scan->>'size','')!~'^[0-9]{1,7}$' then perform private.raise_cohort_error('SOLICITUD_ESCANEO_REQUERIDO');end if;
  if (p_scan->>'size')::integer not between 1 and 2097152 or not exists(select 1 from storage.objects where bucket_id='solicitudes-documentos' and name=p_scan->>'path') then perform private.raise_cohort_error('SOLICITUD_ESCANEO_REQUERIDO');end if;
 elsif p_scan is not null then perform private.raise_cohort_error('SOLICITUD_VERIFICACION_INVALIDA');end if;
 insert into public.solicitud_verificaciones(solicitud_id,tipo,metodo,resultado,nota,actor_id,mode,scan_path,scan_mime,scan_sha256,scan_size)
 values(p_id,p_type,p_method,p_result,btrim(p_note),p_actor,p_mode,p_scan->>'path',p_scan->>'mime',p_scan->>'sha256',(p_scan->>'size')::integer) returning * into v;
 if p_type='estudios' and p_result='verificado' then update public.solicitud_documentos set archivo_verificado_at=v.creado_at where solicitud_id=p_id and tipo_documento='certificado_estudios' and storage_path is not null;end if;
 insert into public.solicitud_auditoria(solicitud_id,actor_id,accion) values(p_id,p_actor,'verificacion_'||p_type);
 return jsonb_build_object('id',v.id,'tipo',v.tipo,'metodo',v.metodo,'resultado',v.resultado,'nota',v.nota,'createdAt',v.creado_at,'mode',v.mode,'scanAvailable',v.scan_path is not null);
end $$;
create or replace function public.reclamar_aprobacion_inscripcion(p_id uuid,p_actor uuid,p_verif_identidad uuid,p_verif_estudios uuid,p_version_aviso text,p_version_terminos text) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('identity') then perform private.require_request_review_v2(p_id,p_actor);end if;
 return public.legacy079_reclamar_aprobacion_inscripcion(p_id,p_actor,p_verif_identidad,p_verif_estudios,p_version_aviso,p_version_terminos);
end $$;
create or replace function public.finalizar_aprobacion_inscripcion(p_id uuid,p_actor uuid,p_claim timestamptz,p_student uuid,p_cohort uuid,p_estado text,p_monto numeric) returns jsonb language plpgsql security invoker set search_path='' as $$declare result jsonb;begin
 if private.enrollment_rule_enabled('identity') then
  perform private.require_enrollment_permission(p_actor,'verify_identity');
  if p_cohort is not null or p_estado<>'pendiente_cohorte' or p_monto is not null then perform private.raise_cohort_error('SOLICITUD_APROBACION_SIN_COHORTE');end if;
 end if;
 result:=public.legacy079_finalizar_aprobacion_inscripcion(p_id,p_actor,p_claim,p_student,p_cohort,p_estado,p_monto);
 if private.enrollment_rule_enabled('identity') then
  update public.solicitudes_inscripcion set estado='archivada',archived_at=clock_timestamp(),linked_enrollment_id=(result->>'enrollmentId')::uuid,review_token=null,review_until=null where id=p_id;
  insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason) values(p_actor,'request_approved_archived','request',p_id::text,jsonb_build_object('studentId',p_student,'enrollmentId',result->>'enrollmentId'),'Aprobación y archivo enlazado');
 end if;return result;
end $$;
create or replace function public.devolver_solicitud_inscripcion(p_id uuid,p_actor uuid,p_motivo text,p_mensaje text,p_nota text) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('identity') then perform private.require_request_review_v2(p_id,p_actor);end if;
 return public.legacy079_devolver_solicitud_inscripcion(p_id,p_actor,p_motivo,p_mensaje,p_nota);
end $$;
create or replace function public.rechazar_solicitud_inscripcion(p_id uuid,p_actor uuid,p_motivo text,p_mensaje text,p_nota text,p_bloqueo_hash text,p_bloqueo_dias integer) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if private.enrollment_rule_enabled('identity') then perform private.require_request_review_v2(p_id,p_actor);end if;
 return public.legacy079_rechazar_solicitud_inscripcion(p_id,p_actor,p_motivo,p_mensaje,p_nota,p_bloqueo_hash,p_bloqueo_dias);
end $$;
-- Incluye archivo antes de paginar, conservando búsqueda parametrizada y orden anteriores.
do $$declare def text;begin
 def:=pg_get_functiondef('public.legacy079_listar_solicitudes_admin(text,text,integer,integer)'::regprocedure);
 def:=replace(def,'legacy079_listar_solicitudes_admin','listar_solicitudes_admin');def:=replace(def,'''enviada'',''devuelta'',''aprobada'',''rechazada''','''enviada'',''devuelta'',''aprobada'',''rechazada'',''archivada''');execute def;
end $$;
create or replace function private.protect_linked_request_v2() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if old.estado in('aprobada','archivada') or old.student_id is not null then perform private.raise_cohort_error('SOLICITUD_ARCHIVO_NO_BORRABLE');end if;return old;
end $$;
drop trigger if exists request_archive_no_delete on public.solicitudes_inscripcion;
create trigger request_archive_no_delete before delete on public.solicitudes_inscripcion for each row execute function private.protect_linked_request_v2();
create or replace function public.revoke_request_approval_v2(p_actor uuid,p_id uuid,p_version timestamptz,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$declare s public.solicitudes_inscripcion;paid boolean;begin
 perform private.require_enrollment_permission(p_actor,'verify_identity');
 if not private.enrollment_rule_enabled('identity') then perform private.raise_cohort_error('SOLICITUD_REGLAS_INACTIVAS');end if;
 select * into s from public.solicitudes_inscripcion where id=p_id for update;
 if not found then perform private.raise_cohort_error('SOLICITUD_NO_ENCONTRADA');end if;
 if s.estado not in('aprobada','archivada') or s.student_id is null then perform private.raise_cohort_error('SOLICITUD_ESTADO_INVALIDO');end if;
 if s.revoked_at is not null then return public.request_review_v2(p_actor,p_id);end if;
 if s.updated_at is distinct from p_version then perform private.raise_cohort_error('SOLICITUD_VERSION_CONFLICTO');end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then perform private.raise_cohort_error('SOLICITUD_MOTIVO_REQUERIDO');end if;
 perform 1 from public.users where id=s.student_id for update;
 perform 1 from public.enrollments where student_id=s.student_id order by id for update;
 paid:=exists(select 1 from public.payments where student_id=s.student_id and estado='aprobado') or exists(select 1 from public.enrollments where student_id=s.student_id and(monto_abonado>0 or paid_amount_centavos>0));
 update public.users set identity_access_blocked_at=clock_timestamp(),activo=case when paid then activo else false end where id=s.student_id;
 if not paid then
  update public.enrollments set status='anulada' where student_id=s.student_id and status in('activo','pendiente_cohorte');
  -- Pagos pendientes/despachados siguen protegidos: no se presume rechazo ni se liberan.
  update public.student_schedule_holds set released_at=clock_timestamp() where reservation_id in(select id from public.student_schedule_reservations where student_id=s.student_id) and released_at is null and not payment_protected;
  update public.student_schedule_reservations set estado='liberada' where student_id=s.student_id and estado='vigente';
  update public.practice_slots set student_id=null,status='liberado' where student_id=s.student_id and status in('asignado','confirmado') and scheduled_at>private.cohortes_now();
 end if;
 update public.solicitudes_inscripcion set revoked_at=clock_timestamp(),revoked_by=p_actor,revocation_reason=btrim(p_reason),revocation_payment_review=paid where id=p_id;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason) values(p_actor,'request_approval_revoked','request',p_id::text,jsonb_build_object('studentId',s.student_id,'paidReview',paid),btrim(p_reason));
 if paid then perform private.identity_alert_v2('SOLICITUD_REVOCADA_CON_PAGO',p_id,'Acceso bloqueado. Revisar matrícula y pago; no se ha ejecutado devolución.');end if;
 return public.request_review_v2(p_actor,p_id);
end $$;
-- Estado→correo neutro en la auditoría existente; jamás copiar contenido sospechoso.
create or replace function private.request_state_email_v2() returns trigger language plpgsql security invoker set search_path='' as $$declare kind text;begin
 if not private.enrollment_rule_enabled('identity') then return new;end if;
 if old.estado is distinct from new.estado and new.estado in('devuelta','rechazada','archivada') and not(new.estado='rechazada' and new.rechazo_motivo_codigo='SPAM') then kind:=new.estado;
 elsif old.revoked_at is null and new.revoked_at is not null then kind:='revocada';end if;
 if kind is not null then insert into public.solicitud_auditoria(solicitud_id,actor_id,accion,email_kind,email_state,email_next_at) values(new.id,new.reviewed_by,'state_email_'||kind,kind,'queued',private.cohortes_now());end if;return new;
end $$;
drop trigger if exists request_state_email on public.solicitudes_inscripcion;
create trigger request_state_email after update on public.solicitudes_inscripcion for each row execute function private.request_state_email_v2();
create or replace function public.claim_request_email_v2() returns jsonb language plpgsql security invoker set search_path='' as $$declare a public.solicitud_auditoria;recipient text;begin
 if not private.enrollment_rule_enabled('identity') then return null;end if;
 select * into a from public.solicitud_auditoria where email_attempts<3 and(email_state in('queued','failed') and email_next_at<=private.cohortes_now() or email_state='processing' and email_lease_until<=private.cohortes_now()) order by creado_at,id for update skip locked limit 1;
 if not found then return null;end if;
 select correo into recipient from public.solicitudes_inscripcion where id=a.solicitud_id;
 if recipient is null then update public.solicitud_auditoria set email_state='failed',email_attempts=3 where id=a.id;return null;end if;
 update public.solicitud_auditoria set email_state='processing',email_attempts=email_attempts+1,email_token=gen_random_uuid(),email_lease_until=private.cohortes_now()+interval '5 minutes' where id=a.id returning * into a;
 return jsonb_build_object('id',a.id,'requestId',a.solicitud_id,'token',a.email_token,'kind',a.email_kind,'to',recipient);
end $$;
create or replace function public.finish_request_email_v2(p_id uuid,p_token uuid,p_sent boolean) returns boolean language plpgsql security invoker set search_path='' as $$declare a public.solicitud_auditoria;begin
 select * into a from public.solicitud_auditoria where id=p_id for update;
 if a.id is null or a.email_token is distinct from p_token or a.email_state<>'processing' or a.email_lease_until<=private.cohortes_now() then perform private.raise_cohort_error('SOLICITUD_CORREO_LEASE_INVALIDO');end if;
 update public.solicitud_auditoria set email_state=case when p_sent then 'sent' else 'failed' end,email_next_at=private.cohortes_now()+interval '15 minutes',email_token=null,email_lease_until=null where id=a.id;
 if p_sent or a.email_attempts>=3 then perform private.identity_alert_v2('SOLICITUD_CORREO_ATASCADO',a.solicitud_id,'Correo de estado pendiente. Revisar el outbox de la solicitud.',p_sent);end if;
 return true;
end $$;
create or replace function public.retry_request_emails_v2(p_actor uuid,p_id uuid,p_reason text) returns integer language plpgsql security invoker set search_path='' as $$declare n integer;begin
 perform private.require_enrollment_permission(p_actor,'verify_identity');
 if not private.enrollment_rule_enabled('identity') then perform private.raise_cohort_error('SOLICITUD_REGLAS_INACTIVAS');end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then perform private.raise_cohort_error('SOLICITUD_MOTIVO_REQUERIDO');end if;
 update public.solicitud_auditoria set email_state='queued',email_attempts=0,email_next_at=private.cohortes_now(),email_token=null,email_lease_until=null where solicitud_id=p_id and email_state='failed';get diagnostics n=row_count;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason) values(p_actor,'request_email_retry','request',p_id::text,jsonb_build_object('retried',n),btrim(p_reason));return n;
end $$;
create or replace function public.request_retention_config_v2() returns jsonb language sql stable security invoker set search_path='' as $$select solicitud_retention_policy from public.app_settings where id$$;
create or replace function public.set_request_retention_v2(p_actor uuid,p_policy jsonb,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 perform private.require_enrollment_permission(p_actor,'verify_identity');
 if not private.enrollment_rule_enabled('identity') then perform private.raise_cohort_error('SOLICITUD_REGLAS_INACTIVAS');end if;
 if p_policy is null or jsonb_typeof(p_policy)<>'object' or not(p_policy ?& array['borradorDias','devueltaDias','certificadoVerificadoDias','huerfanoDias','rechazadaDias','aprobadaDias','archivadaDias']) or p_policy->>'aprobadaDias' is not null or p_policy->>'archivadaDias' is not null
 or exists(select 1 from jsonb_each(p_policy) e where key not in('borradorDias','devueltaDias','certificadoVerificadoDias','huerfanoDias','rechazadaDias','aprobadaDias','archivadaDias'))
 or exists(select 1 from jsonb_each(p_policy) e where key in('borradorDias','devueltaDias','certificadoVerificadoDias','huerfanoDias') and(coalesce(value#>>'{}','')!~'^[0-9]{1,4}$' or (value#>>'{}')::int not between 1 and 3650))
 or(p_policy->>'rechazadaDias' is not null and(coalesce(p_policy->>'rechazadaDias','')!~'^[0-9]{1,4}$' or(p_policy->>'rechazadaDias')::int not between 1 and 3650))
 or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then perform private.raise_cohort_error('SOLICITUD_RETENCION_INVALIDA');end if;
 update public.app_settings set solicitud_retention_policy=p_policy where id;
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason) values(p_actor,'request_retention_changed','settings','global',p_policy,btrim(p_reason));return p_policy;
end $$;
-- Purga de escaneo conserva la prueba y la trazabilidad inmutables.
create or replace function public.impedir_cambio_verificacion() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='UPDATE' and current_setting('app.scan_retention',true)='true' and (to_jsonb(new)-'scan_deleted_at')=(to_jsonb(old)-'scan_deleted_at') and old.scan_deleted_at is null and new.scan_deleted_at is not null then return new;end if;
 raise exception 'Las verificaciones son append-only' using errcode='SI409';
end $$;
drop trigger solicitud_verificaciones_inmutables on public.solicitud_verificaciones;
create trigger solicitud_verificaciones_inmutables before update or delete on public.solicitud_verificaciones for each row execute function public.impedir_cambio_verificacion();
create or replace function public.mark_verification_scan_deleted_v2(p_id uuid,p_path text) returns boolean language plpgsql security invoker set search_path='' as $$begin
 perform set_config('app.scan_retention','true',true);update public.solicitud_verificaciones set scan_deleted_at=clock_timestamp() where id=p_id and scan_path=p_path and scan_deleted_at is null;return found;
end $$;
create or replace function public.listar_objetos_huerfanos_solicitudes(p_antes timestamptz,p_limite integer) returns text[] language sql stable security invoker set search_path='' as $$
 select coalesce(array_agg(o.name),'{}') from(select name from storage.objects where bucket_id='solicitudes-documentos' and created_at<p_antes
 and not exists(select 1 from public.solicitud_documentos d where d.storage_path=storage.objects.name)
 and not exists(select 1 from public.solicitud_verificaciones v where v.scan_path=storage.objects.name)
 order by created_at,name limit least(greatest(coalesce(p_limite,100),1),500)) o$$;
create or replace function public.assert_identity_permission_v2(p_actor uuid) returns void language sql security invoker set search_path='' as $$select private.require_enrollment_permission(p_actor,'verify_identity')$$;
create or replace function public.student_payment_statuses_v2(p_actor uuid,p_students uuid[]) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin
 perform private.require_enrollment_permission(p_actor,'view_payments_invoices');
 return coalesce((select jsonb_object_agg(u.id::text,case when exists(select 1 from public.payments p where p.student_id=u.id and p.estado='revision') then 'revision'
 when exists(select 1 from public.payments p where p.student_id=u.id and p.estado='aprobado') or exists(select 1 from public.enrollments e where e.student_id=u.id and e.monto_abonado>0) then 'pagado'
 when exists(select 1 from public.payments p where p.student_id=u.id and p.estado='pendiente') then 'pendiente' else 'sin_pago' end) from public.users u where u.id=any(p_students) and u.rol='estudiante'),'{}'::jsonb);end $$;
-- Bloqueo de acceso conserva la decisión incluso al apagar el indicador después de revocar.
do $$begin
 if to_regprocedure('private.legacy079_enrollment_has_access_v2(uuid)') is null then alter function private.enrollment_has_access_v2(uuid) rename to legacy079_enrollment_has_access_v2;end if;
 if to_regprocedure('private.legacy079_content_student_eligible(uuid,uuid)') is null then alter function private.content_student_eligible(uuid,uuid) rename to legacy079_content_student_eligible;end if;
end $$;
create or replace function private.enrollment_has_access_v2(p_enrollment uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.enrollments e join public.users u on u.id=e.student_id where e.id=p_enrollment and u.identity_access_blocked_at is null) and private.legacy079_enrollment_has_access_v2(p_enrollment)$$;
create or replace function private.content_student_eligible(p_student uuid,p_course uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.users where id=p_student and identity_access_blocked_at is null) and private.legacy079_content_student_eligible(p_student,p_course)$$;
-- Cualquier RPC nueva o respaldo conserva ACL exclusiva del backend.
do $$declare r record;begin for r in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where(n.nspname='public' and(p.proname like 'legacy079_%' or p.proname in('assert_identity_permission_v2','student_payment_statuses_v2','retry_request_emails_v2','request_review_v2','register_request_verification_v2','revoke_request_approval_v2','claim_request_email_v2','finish_request_email_v2','request_retention_config_v2','set_request_retention_v2','mark_verification_scan_deleted_v2','registrar_verificacion_inscripcion','reclamar_aprobacion_inscripcion','finalizar_aprobacion_inscripcion','devolver_solicitud_inscripcion','rechazar_solicitud_inscripcion','listar_solicitudes_admin','impedir_cambio_verificacion','protect_solicitud_date','listar_objetos_huerfanos_solicitudes')))
 or(n.nspname='private' and p.proname in('identity_alert_v2','require_request_review_v2','protect_linked_request_v2','request_state_email_v2','touch_request_version_v2','enrollment_has_access_v2','content_student_eligible','legacy079_enrollment_has_access_v2','legacy079_content_student_eligible')) loop execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',r.nspname,r.proname,r.args);execute format('grant execute on function %I.%I(%s) to service_role',r.nspname,r.proname,r.args);end loop;end $$;
update public.enrollment_rule_flags set implemented=true,enabled=false where key='identity';
notify pgrst,'reload schema';
commit;
