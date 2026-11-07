-- I10/H7. MANUAL después de059. USD en centavos; IVA pendiente de decisión, cero explícito.
begin;
set local lock_timeout='5s';
do $$ declare f text;begin
 foreach f in array array['public.manage_student_reservation(uuid,text,uuid,integer,integer,integer)',
 'private.confirm_student_reservation(uuid,uuid)','private.student_reservation_json(uuid)',
 'public.delete_student_data(uuid,uuid,timestamptz,text[])'] loop
 if to_regprocedure(f) is null then raise exception '060 requiere059 completa; falta %',f;end if;end loop;
 if to_regclass('public.student_schedule_holds') is null or to_regclass('public.student_schedule_events') is null then
 raise exception '060 requiere059 completa';end if;
 if to_regclass('public.payments') is not null then raise exception 'payments ya existe:060 requiere revisión, no se modifica';end if;
end $$;
do $$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.manage_student_reservation(uuid,text,uuid,integer,integer,integer)')) is distinct from '6e547bb5f1c9196d37bc50b7c169e127' then raise exception '060: cuerpo distinto al revisado: public.manage_student_reservation(uuid,text,uuid,integer,integer,integer)';end if;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.student_reservation_json(uuid)')) is distinct from '07576532175c23401fc166ef9c4741d5' then raise exception '060: cuerpo distinto al revisado: private.student_reservation_json(uuid)';end if;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.delete_student_data(uuid,uuid,timestamptz,text[])')) is distinct from '7f4a4b6eef9d99b30d469ddafdd976ef' then raise exception '060: cuerpo distinto al revisado: public.delete_student_data(uuid,uuid,timestamptz,text[])';end if;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.begin_student_deletion(uuid,uuid,text)')) is distinct from '68908b6fa7be09f7cbc26cb3ec4b128e' then raise exception '060: cuerpo distinto al revisado: public.begin_student_deletion(uuid,uuid,text)';end if;
end $$;

create table public.payments(
 id uuid primary key default gen_random_uuid(),
 student_id uuid references public.users(id) on delete set null,
 enrollment_id uuid references public.enrollments(id) on delete set null,
 reservation_id uuid references public.student_schedule_reservations(id) on delete set null,
 attempt_key uuid not null unique,
 proveedor text not null check(proveedor in ('simulado','manual','kushki')),
 referencia text check(length(referencia) between 1 and 200),
 estado text not null default 'pendiente' check(estado in ('pendiente','rechazado','aprobado','revision')),
 subtotal_centavos bigint not null check(subtotal_centavos between 0 and 10000000000),
 recargo_centavos integer not null check(recargo_centavos between 0 and 1000000),
 iva_centavos integer not null default 0 check(iva_centavos=0),
 total_centavos bigint not null check(total_centavos=subtotal_centavos+recargo_centavos+iva_centavos),
 moneda text not null default 'USD' check(moneda='USD'),
 recibido_centavos bigint,
 recibido_moneda text,
 motivo_revision text,
 actor_id uuid,
 comprobante text check(length(comprobante)<=160),
 dispatch_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 confirmed_at timestamptz,
 unique(proveedor,referencia)
);
create unique index payments_one_pending on public.payments(enrollment_id) where estado='pendiente';
create unique index payments_one_approved on public.payments(enrollment_id) where estado='aprobado';
create index payments_student on public.payments(student_id,created_at desc,id);
create index payments_reservation on public.payments(reservation_id);
create index payments_revision on public.payments(created_at,id) where estado='revision';
create table public.payment_events(
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null references public.payments(id),
 proveedor text not null check(proveedor in ('simulado','manual','kushki')),
 event_key text not null check(event_key ~ '^[a-f0-9]{64}$'),
 body_hash text not null check(body_hash ~ '^[a-f0-9]{64}$'),
 resultado text not null check(resultado in ('pendiente','rechazado','aprobado')),
 created_at timestamptz not null default clock_timestamp(),
 unique(proveedor,event_key)
);
create index payment_events_payment on public.payment_events(payment_id,created_at);
create table public.payment_mail_outbox(
 payment_id uuid primary key references public.payments(id),
 estado text not null default 'pendiente' check(estado in ('pendiente','enviando','enviado','fallido')),
 intentos integer not null default 0 check(intentos between 0 and 5),
 lease_token uuid,lease_until timestamptz,
 next_attempt_at timestamptz not null default clock_timestamp(),
 sent_at timestamptz,
 check((lease_token is null)=(lease_until is null))
);
create index payment_mail_retry on public.payment_mail_outbox(next_attempt_at) where estado in ('pendiente','enviando');
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_mail_outbox enable row level security;
revoke all on public.payments,public.payment_events,public.payment_mail_outbox from public,anon,authenticated,service_role;
grant select,insert,update on public.payments,public.payment_mail_outbox to service_role;
grant select,insert on public.payment_events to service_role;

create function private.payment_json(p_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'reservationId',p.reservation_id,'enrollmentId',p.enrollment_id,
 'proveedor',p.proveedor,'estado',p.estado,'subtotalCentavos',p.subtotal_centavos,
 'recargoCentavos',p.recargo_centavos,'ivaCentavos',p.iva_centavos,'totalCentavos',p.total_centavos,
 'moneda',p.moneda,'createdAt',p.created_at,'confirmedAt',p.confirmed_at,'serverNow',clock_timestamp(),
 'requiereRevision',p.estado='revision') from public.payments p where p.id=p_id
$$;
create function public.begin_student_payment(p_student uuid,p_reserva uuid,p_proveedor text,p_attempt uuid,
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
-- Una sola salida al proveedor por intento. Si se corta la red tras enviar, no se cobra
-- otra vez automáticamente: sigue pendiente hasta webhook/conciliación de I11.
create function public.claim_payment_dispatch(p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$ begin
 update public.payments set dispatch_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_id and estado='pendiente' and dispatch_at is null;
 return found;
end $$;
create function public.record_payment_reference(p_id uuid,p_proveedor text,p_referencia text) returns void
language plpgsql security invoker set search_path='' as $$ begin
 if p_referencia is null or p_referencia !~ '^[A-Za-z0-9_.:-]{1,200}$' then raise exception 'Referencia inválida' using errcode='22023';end if;
 update public.payments set referencia=p_referencia,updated_at=clock_timestamp()
 where id=p_id and proveedor=p_proveedor and(referencia is null or referencia=p_referencia
  or(proveedor='kushki' and referencia='kushki-rechazado:'||id::text));
 if not found then raise exception 'Referencia no corresponde al intento' using errcode='IP409';end if;
end $$;

create function public.confirm_student_payment(p_id uuid,p_proveedor text,p_referencia text,p_resultado text,
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

create function public.admin_release_student_reservation(p_actor uuid,p_reserva uuid) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.student_schedule_reservations;v_student uuid;begin
 if not exists(select 1 from public.users where id=p_actor and rol='admin' and activo) then raise exception 'Administrador requerido' using errcode='42501';end if;
 select student_id into v_student from public.student_schedule_reservations where id=p_reserva;
 if not found then raise exception 'Reserva no encontrada' using errcode='IP404';end if;
 perform 1 from public.users where id=v_student for update;
 perform 1 from public.enrollments where student_id=v_student order by id for update;
 select * into r from public.student_schedule_reservations where id=p_reserva for update;
 if exists(select 1 from public.payments where reservation_id=r.id and estado in ('pendiente','aprobado','revision')) then
 raise exception 'No liberar un horario con pago pendiente o recibido' using errcode='IP410';end if;
 if r.estado='confirmada' then raise exception 'Horario confirmado no es una reserva' using errcode='IP409';end if;
 perform private.close_student_reservation(r.id,'liberada');
 return private.student_reservation_json(r.id);
end $$;
-- Outbox con lease: no llama correo bajo lock ni conserva destinatarios en tablas.
create function public.claim_payment_email(p_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$ declare token uuid:=gen_random_uuid();begin
 update public.payment_mail_outbox set estado='enviando',intentos=intentos+1,lease_token=token,
 lease_until=clock_timestamp()+interval '2 minutes' where payment_id=p_id and intentos<5
 and estado in ('pendiente','enviando') and next_attempt_at<=clock_timestamp()
 and(lease_until is null or lease_until<=clock_timestamp());
 if not found then return null;end if;return token;
end $$;
create function public.finish_payment_email(p_id uuid,p_token uuid,p_ok boolean) returns boolean
language plpgsql security invoker set search_path='' as $$ begin
 update public.payment_mail_outbox set estado=case when p_ok then 'enviado' when intentos>=5 then 'fallido' else 'pendiente' end,
 lease_token=null,lease_until=null,sent_at=case when p_ok then clock_timestamp() else sent_at end,
 next_attempt_at=clock_timestamp()+interval '5 minutes'
 where payment_id=p_id and lease_token=p_token and estado='enviando';return found;
end $$;

create or replace function public.manage_student_reservation(p_student uuid,p_accion text,p_id uuid default null,
 p_extension integer default 10,p_max_extensiones integer default 1,p_gracia integer default 10)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.student_schedule_reservations;v_now timestamptz;v_end timestamptz;begin
 if p_accion is null or p_accion not in ('actual','ampliar','liberar','iniciar_pago') or p_extension is null or p_extension not between 1 and 10
 or p_max_extensiones is null or p_max_extensiones not between 0 and 1 or p_gracia is null or p_gracia not between 1 and 10 then
 raise exception 'Acción inválida' using errcode='22023';end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then raise exception 'Cuenta inactiva' using errcode='IR403';end if;
 perform private.assert_student_not_deleting(p_student);
 perform public.expire_student_reservations(p_student);
 select * into r from public.student_schedule_reservations where student_id=p_student
 and(p_id is null or id=p_id) order by creada_at desc,id limit 1 for update;
 if not found then
 if p_accion='actual' then return null;end if;
 raise exception 'Reserva no encontrada' using errcode='IR404';end if;
 if p_accion='actual' then return private.student_reservation_json(r.id);end if;
 if p_accion='liberar' and r.estado in ('liberada','vencida') then return private.student_reservation_json(r.id);end if;
 if r.estado not in ('vigente','pago_en_curso') then
 -- No excepción tras limpieza: una excepción revertiría la expiración perezosa.
 return private.student_reservation_json(r.id);end if;
 if p_accion='liberar' then
 if r.estado='pago_en_curso' then raise exception 'Hay un pago en curso; espera el resultado' using errcode='IR412';end if;
 perform private.close_student_reservation(r.id,'liberada');return private.student_reservation_json(r.id);end if;
 if p_accion='ampliar' and(r.estado<>'vigente' or r.extensiones>=p_max_extensiones or r.pago_iniciado_at is not null) then
 raise exception 'No puedes ampliar esta reserva' using errcode='IR411';end if;
 if p_accion='iniciar_pago' and r.estado='pago_en_curso' then return private.student_reservation_json(r.id);end if;
 perform 1 from public.cohorts where id=r.cohort_id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 v_now:=clock_timestamp();
 if r.expira_at<=v_now or exists(select 1 from public.student_schedule_holds where reservation_id=r.id and scheduled_at<=v_now) then perform private.close_student_reservation(r.id,'vencida');return private.student_reservation_json(r.id);end if;
 v_end:=case when p_accion='ampliar' then r.expira_at+make_interval(mins=>p_extension)
 else greatest(r.expira_at,coalesce(r.pago_iniciado_at,v_now)+make_interval(mins=>p_gracia)) end;
 update public.student_schedule_holds set expira_at=v_end where reservation_id=r.id and released_at is null;
 update public.student_schedule_reservations set expira_at=v_end,
 extensiones=extensiones+case when p_accion='ampliar' then 1 else 0 end,
 estado=case when p_accion='iniciar_pago' then 'pago_en_curso' else estado end,
 pago_iniciado_at=case when p_accion='iniciar_pago' then coalesce(pago_iniciado_at,v_now) else pago_iniciado_at end where id=r.id;
 update public.enrollments set reserva_expira_at=v_end where id=r.enrollment_id and etapa_inscripcion='reservado';
 insert into public.student_schedule_events(reservation_id,accion) values(r.id,case when p_accion='ampliar' then 'ampliada' else 'pago_iniciado' end);
 return private.student_reservation_json(r.id);
end $$;
create or replace function private.student_reservation_json(p_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select jsonb_build_object('id',r.id,'enrollmentId',r.enrollment_id,'estado',r.estado,
 'expiraAt',r.expira_at,'serverNow',clock_timestamp(),'extensiones',r.extensiones,
 'puedeAmpliar',r.estado='vigente' and r.pago_iniciado_at is null and r.extensiones<1 and r.expira_at>clock_timestamp(),
 'cohorte',jsonb_build_object('id',c.id,'nombre',c.nombre),
 'franjas',(select coalesce(jsonb_agg(jsonb_build_object('scheduledAt',h.scheduled_at)
 order by h.scheduled_at),'[]'::jsonb) from public.student_schedule_holds h where h.reservation_id=r.id))
 from public.student_schedule_reservations r join public.cohorts c on c.id=r.cohort_id where r.id=p_id
$$;
create or replace function public.delete_student_data(p_actor uuid,p_student uuid,p_version timestamptz,p_cleaned_paths text[])
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare op public.student_deletion_operations; v_role public.user_role; v_cut timestamptz;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  select rol into v_role from public.users where id=p_student for update;
  if found and v_role<>'estudiante' then raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
  select * into op from public.student_deletion_operations where student_id=p_student for update;
  if not found then raise exception 'Operación no encontrada' using errcode='CD404'; end if;
  if op.phase<>'storage' or op.updated_at is distinct from p_version then return to_jsonb(op); end if;
  if exists(select 1 from public.users where id=p_student and activo) then
    raise exception 'Primero bloquear el acceso' using errcode='CD030'; end if;
  if exists(select 1 from public.payments where student_id=p_student and estado in ('pendiente','aprobado','revision')) then
    raise exception 'Resolver y conservar el historial de pagos antes de eliminar' using errcode='IP423'; end if;
  -- FOR UPDATE del padre bloquea nuevos documentos/links por FK; después releer
  -- los documentos bajo lock incluye escrituras que ya estaban en vuelo.
  perform 1 from public.solicitudes_inscripcion where student_id=p_student order by id for update;
  perform 1 from public.solicitud_documentos where solicitud_id in
    (select id from public.solicitudes_inscripcion where student_id=p_student) order by id for update;
  if exists(select 1 from public.solicitud_documentos d join public.solicitudes_inscripcion s on s.id=d.solicitud_id
    where s.student_id=p_student and not coalesce(d.storage_path=any(p_cleaned_paths),false)) then
    raise exception 'Repetir limpieza de Storage' using errcode='CD032'; end if;
  delete from public.solicitud_documentos where solicitud_id in
    (select id from public.solicitudes_inscripcion where student_id=p_student);
  delete from public.solicitudes_inscripcion where student_id=p_student;
  delete from public.attempt_answers where attempt_id in (select id from public.exam_attempts where student_id=p_student);
  delete from public.exam_attempts where student_id=p_student;
  delete from public.practice_slot_cancellations where student_id=p_student;
  perform 1 from public.practice_slots where student_id=p_student order by id for update;
  -- RF-04: limpiar antes de las franjas/usuario; conservar guards y CAS.
  delete from public.practice_ratings where student_id=p_student;
  v_cut:=clock_timestamp();
  delete from public.practice_slots where student_id=p_student and scheduled_at<=v_cut;
  update public.practice_slots set student_id=null,status='liberado',attended=null,confirmed_at=null,
    confirmation_notified_at=null,release_notified_at=null where student_id=p_student and scheduled_at>v_cut;
  delete from public.enrollment_documents where enrollment_id in (select id from public.enrollments where student_id=p_student);
  delete from public.enrollments where student_id=p_student;
  -- Eliminar fila entera: cubre response/request_hash y request si se incorporase.
  delete from public.manual_enrollment_operations where student_id=p_student;
  delete from public.student_practice_recovery where student_id=p_student;
  delete from public.users where id=p_student;
  update public.student_deletion_operations set phase='auth',status='pendiente',data_deleted_by=p_actor,
    data_deleted_at=clock_timestamp(),updated_at=clock_timestamp() where student_id=p_student returning * into op;
  return to_jsonb(op);
end $$;
create or replace function public.begin_student_deletion(p_actor uuid,p_student uuid,p_confirmation text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare u public.users; op public.student_deletion_operations;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  select * into u from public.users where id=p_student for update;
  if found and u.rol<>'estudiante' then
    raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
  if exists(select 1 from public.payments where student_id=p_student and estado in ('pendiente','aprobado','revision')) then
    raise exception 'Resolver el historial de pagos antes de eliminar' using errcode='IP423';end if;
  select * into op from public.student_deletion_operations where student_id=p_student for update;
  if found then
    if op.status='completo' then return to_jsonb(op); end if;
    update public.student_deletion_operations set status='pendiente',last_retry_actor_id=p_actor,
      last_retry_at=clock_timestamp(),retry_count=retry_count+1,updated_at=clock_timestamp()
      where student_id=p_student returning * into op;
  else
    if u.id is null then raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
    if p_confirmation is null or p_confirmation is distinct from u.cedula then
      raise exception 'La confirmación no coincide' using errcode='CD031'; end if;
    insert into public.student_deletion_operations(student_id,actor_id) values(p_student,p_actor) returning * into op;
  end if;
  -- Primer efecto del bloqueo, en la misma transacción que la confirmación.
  update public.users set activo=false where id=p_student;
  return to_jsonb(op);
end $$;
revoke all on function private.payment_json(uuid),public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text),public.claim_payment_dispatch(uuid),public.record_payment_reference(uuid,text,text),public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text),public.admin_release_student_reservation(uuid,uuid),public.claim_payment_email(uuid),public.finish_payment_email(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function private.payment_json(uuid),public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text),public.claim_payment_dispatch(uuid),public.record_payment_reference(uuid,text,text),public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text),public.admin_release_student_reservation(uuid,uuid),public.claim_payment_email(uuid),public.finish_payment_email(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
