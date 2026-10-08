-- Checklist informativo y abono inicial de la matrícula manual.
-- monto_total conserva el precio NETO: cohorts.precio - descuento.
-- En pendiente_cohorte no hay precio ni saldo: descuento = 0 y el abono
-- recibido puede superar el futuro precio. Al asignar cohorte en otro módulo,
-- validar monto_abonado <= precio - descuento antes de fijar monto_total.
-- El futuro historial de pagos importará este abono inicial una sola vez
-- por enrollment_id como saldo de apertura; no lo sumará dos veces.
begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog, public, extensions, pg_temp;
lock table public.enrollments in access exclusive mode;

alter table public.enrollments add constraint enrollments_pending_discount_zero
  check (monto_total is not null or descuento = 0);

create table public.enrollment_documents (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  tipo text not null check (tipo in ('cedula','papeleta_votacion','tipo_sangre','titulo_bachiller')),
  estado text not null check (estado in ('entregado','pendiente','no_aplica')),
  fecha_marcado timestamptz,
  marcado_por uuid references public.users(id) on delete restrict,
  primary key (enrollment_id, tipo),
  check ((fecha_marcado is null) = (marcado_por is null))
);
comment on table public.enrollment_documents is
  'Checklist informativo; nunca bloquea matrícula, pagos ni exámenes. Cuatro filas por matrícula.';
create index enrollment_documents_pending_idx on public.enrollment_documents(enrollment_id)
  where estado = 'pendiente';
alter table public.enrollment_documents enable row level security;
revoke all on public.enrollment_documents from public, anon, authenticated;
grant select, insert, update, delete on public.enrollment_documents to service_role;

insert into public.enrollment_documents(enrollment_id,tipo,estado)
select e.id, d.tipo,
  case when d.tipo = 'papeleta_votacion' and u.fecha_nacimiento is not null
    and date_part('year', age((clock_timestamp() at time zone 'America/Guayaquil')::date,
                              u.fecha_nacimiento)) >= 65
    then 'no_aplica' else 'pendiente' end
from public.enrollments e join public.users u on u.id = e.student_id
cross join (values ('cedula'),('papeleta_votacion'),('tipo_sangre'),('titulo_bachiller')) d(tipo);

-- También cubre inserciones por los otros flujos de matrícula.
create function public.initialize_enrollment_documents() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_birth date; v_senior boolean;
begin
  select fecha_nacimiento into v_birth from public.users where id=new.student_id;
  v_senior := v_birth is not null and
    date_part('year', age((clock_timestamp() at time zone 'America/Guayaquil')::date, v_birth)) >= 65;
  insert into public.enrollment_documents(enrollment_id,tipo,estado)
  select new.id,d.tipo,
    case when v_senior and d.tipo='papeleta_votacion' then 'no_aplica' else 'pendiente' end
  from (values ('cedula'),('papeleta_votacion'),('tipo_sangre'),('titulo_bachiller')) d(tipo);
  return new;
end $$;
create trigger enrollments_initialize_documents after insert on public.enrollments
  for each row execute function public.initialize_enrollment_documents();
revoke all on function public.initialize_enrollment_documents() from public, anon, authenticated;
grant execute on function public.initialize_enrollment_documents() to service_role;

-- DROP + CREATE en la misma transacción: PostgREST no conserva dos sobrecargas.
drop function public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid);
create function public.commit_manual_enrollment(
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

create function public.update_manual_enrollment_details(
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

revoke all on function public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb),
  public.update_manual_enrollment_details(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.commit_manual_enrollment(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamptz[],uuid,jsonb,jsonb),
  public.update_manual_enrollment_details(uuid,uuid,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
