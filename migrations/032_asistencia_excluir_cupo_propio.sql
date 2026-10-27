-- RF-03. 032: excluir para cada alumno las franjas que solto.
-- Aplicar manualmente tras el preflight; no modifica datos.
begin;
set local lock_timeout = '5s';

-- La vista previa E1 tampoco cuenta franjas soltadas antes.
create or replace function private.eligible_free_slots_for_enrollment(
  p_enrollment_id uuid, p_excluded_slot_id uuid default null
) returns setof public.practice_slots
language plpgsql stable security invoker set search_path = '' as $$
declare e public.enrollments; v_end date; v_end_text text; v_mode text; v_now timestamptz := clock_timestamp();
begin
  select * into e from public.enrollments where id = p_enrollment_id;
  if not found then raise exception 'Matrícula no encontrada' using errcode = 'CD404'; end if;
  v_end_text := e.practice_plan->>'fechaFinElegida';
  v_mode := e.practice_plan->>'modalidad';
  if v_end_text is null or v_end_text !~ '^\d{4}-\d{2}-\d{2}$'
    or v_mode is null or v_mode not in ('entre_semana', 'fin_de_semana') then
    raise exception 'La matrícula no tiene fecha fin o modalidad de prácticas válida; requiere revisión'
      using errcode = 'CD409';
  end if;
  begin
    v_end := v_end_text::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'La fecha fin de prácticas de la matrícula es inválida; requiere revisión'
      using errcode = 'CD409';
  end;
  return query
    select s.* from public.practice_slots s
    join public.users instructor on instructor.id = s.instructor_id and instructor.activo
    join public.users student on student.id = e.student_id and student.activo
    where e.status = 'activo' and s.cohort_id = e.cohort_id
      and s.id is distinct from p_excluded_slot_id
      and not exists (
        select 1 from public.practice_slot_cancellations c
        where c.student_id = e.student_id and c.slot_id = s.id
      )
      and s.status in ('disponible', 'liberado') and s.student_id is null
      and s.duration_minutes = 60
      and s.scheduled_at > v_now
      -- Coincide con el límite vigente de reclamación: no ofrecer alternativas cerradas a T-5.
      and public.practice_slot_window_open(s.scheduled_at, v_now)
      and (s.scheduled_at at time zone 'America/Guayaquil')::date <= v_end
      and ((v_mode = 'entre_semana' and extract(isodow from s.scheduled_at at time zone 'America/Guayaquil') between 1 and 5)
        or (v_mode = 'fin_de_semana' and extract(isodow from s.scheduled_at at time zone 'America/Guayaquil') in (6, 7)))
      and not exists (
        select 1 from public.practice_slots own
        where own.student_id = e.student_id and own.id is distinct from p_excluded_slot_id
          and own.status in ('asignado', 'confirmado', 'completado')
          and tsrange(own.scheduled_at at time zone 'UTC',
            (own.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
          && tsrange(s.scheduled_at at time zone 'UTC',
            (s.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
      )
    order by s.scheduled_at, s.id;
end;
$$;

-- La lista E2 y el chequeo bajo locks comparten elegibilidad.
create or replace function private.eligible_practice_slot_changes(p_enrollment_id uuid)
returns table(slot public.practice_slots, caso text, source_slot_ids uuid[])
language plpgsql stable security invoker set search_path = '' as $$
declare e public.enrollments; b record;
begin
  select * into e from public.enrollments where id = p_enrollment_id and status = 'activo';
  if not found or not exists(select 1 from public.users where id = e.student_id and rol = 'estudiante' and activo) then return; end if;
  select * into b from private.practice_replacement_balance(e.id);
  if b.reposiciones_pendientes = 0 and e.reprogramaciones_usadas >= 2 then return; end if;
  -- Una única fórmula para A y B: en B se excluye SOLO la franja que se soltaría.
  -- Así puede cambiarse de hora en el mismo día sin exceder el cupo diario.
  return query
    with sources as (
      select null::uuid as id where b.reposiciones_pendientes > 0
      union all
      select p.id from private.pending_practice_slots(e.id) p where b.reposiciones_pendientes = 0
    ), pairs as (
      select f.id as target_id, src.id as source_id
      from sources src cross join lateral private.eligible_free_slots_for_enrollment(e.id, src.id) f
      where not exists (
        select 1 from public.practice_slot_cancellations c
        where c.student_id = e.student_id and c.slot_id = f.id
      )
        and (select coalesce(sum(own.duration_minutes), 0) from public.practice_slots own
        where own.student_id = e.student_id and own.cohort_id = e.cohort_id
          and own.status in ('asignado', 'confirmado', 'completado') and own.id is distinct from src.id
          and (own.scheduled_at at time zone 'America/Guayaquil')::date =
              (f.scheduled_at at time zone 'America/Guayaquil')::date) + f.duration_minutes <= b.horas_por_dia * 60
    )
    select s, case when b.reposiciones_pendientes > 0 then 'A' else 'B' end,
      coalesce(array_agg(p.source_id order by p.source_id) filter (where p.source_id is not null), '{}'::uuid[])
    from pairs p join public.practice_slots s on s.id = p.target_id
    group by s.id order by s.scheduled_at, s.id;
end;
$$;

-- La RPC protege /swap y /claim incluso sin consultar la lista.
create or replace function public.swap_practice_slot(p_slot_id uuid, p_student_id uuid, p_source_slot_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' set lock_timeout = '5s' as $$
declare target public.practice_slots; source public.practice_slots; e public.enrollments;
  b record; candidate record; v_cancel uuid; v_now timestamptz; v_number smallint;
begin
  -- Orden común con E1/eliminación: alumno -> matrícula -> franjas por UUID.
  -- UPDATE del alumno serializa también cambios en otras matrículas del mismo alumno.
  perform 1 from public.users where id = p_student_id and rol = 'estudiante' and activo for update;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  perform private.assert_student_not_deleting(p_student_id);
  select * into target from public.practice_slots where id = p_slot_id;
  if not found then raise exception 'Cupo no encontrado' using errcode = 'CD404'; end if;
  select * into e from public.enrollments where student_id = p_student_id
    and cohort_id = target.cohort_id and status = 'activo' for update;
  if not found then raise exception 'No tienes matrícula activa en la cohorte de este cupo' using errcode = 'CD403'; end if;
  if p_source_slot_id is not null and not exists(select 1 from private.pending_practice_slots(e.id) where id = p_source_slot_id) then
    raise exception 'La práctica a soltar no es una práctica futura propia de esta matrícula' using errcode = 'CD409'; end if;
  perform 1 from public.practice_slots where id = p_slot_id or id = p_source_slot_id order by id for update;
  select * into target from public.practice_slots where id = p_slot_id;
  if not found or target.status not in ('disponible', 'liberado') or target.student_id is not null then
    raise exception 'Otro alumno tomó este cupo o ya no está disponible' using errcode = 'CD409'; end if;
  if target.cohort_id is distinct from e.cohort_id then
    raise exception 'El cupo cambió; vuelve a consultar' using errcode = 'CD409'; end if;
  -- Conserva activo al instructor hasta el commit; el helper E1 también lo valida.
  if exists(select 1 from public.practice_slot_cancellations c
      where c.student_id = p_student_id and c.slot_id = target.id) then
    raise exception 'No puedes volver a tomar una práctica que tú mismo soltaste' using errcode = 'CD409'; end if;
  perform 1 from public.users where id = target.instructor_id and rol = 'instructor' and activo for share;
  if not found then raise exception 'El instructor está inactivo' using errcode = 'CD023'; end if;
  select * into b from private.practice_replacement_balance(e.id);
  if b.reposiciones_pendientes > 0 and p_source_slot_id is not null then
    raise exception 'Tienes una hora pendiente por reponer: no debes soltar otra práctica' using errcode = '22023';
  elsif b.reposiciones_pendientes = 0 then
    if e.reprogramaciones_usadas >= 2 then
      raise exception 'Ya usaste tus 2 reprogramaciones; no puedes cambiar otra práctica' using errcode = 'CD409'; end if;
    if p_source_slot_id is null then
      raise exception 'Debes elegir la práctica pendiente que vas a soltar' using errcode = '22023'; end if;
  end if;
  select * into candidate from private.eligible_practice_slot_changes(e.id) c where (c.slot).id = p_slot_id;
  if not found or (candidate.caso = 'B' and not p_source_slot_id = any(candidate.source_slot_ids)) then
    raise exception 'Este cupo no es elegible: revisa horario, modalidad, fecha fin y horas del día' using errcode = 'CD409'; end if;
  v_now := clock_timestamp();
  if not public.practice_slot_window_open(target.scheduled_at, v_now) then
    raise exception 'Faltan 5 minutos o menos: el cupo ya cerró' using errcode = 'CD409'; end if;
  if candidate.caso = 'B' then
    select * into source from private.pending_practice_slots(e.id) where id = p_source_slot_id;
    if not found then raise exception 'La práctica que ibas a soltar ya empezó o cambió' using errcode = 'CD409'; end if;
    update public.enrollments set reprogramaciones_usadas = reprogramaciones_usadas + 1
      where id = e.id returning reprogramaciones_usadas into v_number;
    insert into public.practice_slot_cancellations(slot_id, enrollment_id, student_id, instructor_id,
      cohort_id, slot_starts_at, cancelled_at, motivo_categoria, motivo_texto, resultado,
      consumio_reprogramacion, reprogramacion_numero, origen, repuesto_por_slot_id, repuesto_en)
      values(source.id, e.id, p_student_id, source.instructor_id, source.cohort_id, source.scheduled_at,
        v_now, 'otro', 'Cambio de práctica por cupo disponible', 'reprogramable', true, v_number,
        'cambio_cupo', target.id, v_now) returning id into v_cancel;
    -- Primero libera el origen: evita la exclusión GiST si se superponen origen y destino.
    update public.practice_slots set student_id = null, status = 'liberado', attended = null,
      confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
      where id = source.id and student_id = p_student_id and status in ('asignado', 'confirmado')
        and scheduled_at > clock_timestamp();
    if not found then raise exception 'La práctica que ibas a soltar ya empezó o cambió' using errcode = 'CD409'; end if;
  else
    select c.id into v_cancel from public.practice_slot_cancellations c
      where c.enrollment_id = e.id and c.resultado = 'reprogramable' and c.origen = 'alumno' and c.repuesto_en is null
      order by c.cancelled_at, c.id limit 1 for update;
    if not found then raise exception 'La reposición ya fue utilizada; vuelve a consultar' using errcode = 'CD409'; end if;
    update public.practice_slot_cancellations set repuesto_por_slot_id = target.id, repuesto_en = v_now where id = v_cancel;
  end if;
  update public.practice_slots set student_id = p_student_id, status = 'asignado', attended = null,
    confirmed_at = null, confirmation_notified_at = null, release_notified_at = null
    where id = target.id and student_id is null and status in ('disponible', 'liberado')
      and public.practice_slot_window_open(scheduled_at, clock_timestamp()) returning * into target;
  if not found then
    -- También revierte contador/historial/origen si se cruzó T-5 DURANTE la escritura.
    raise exception 'Faltan 5 minutos o menos: el cupo ya cerró' using errcode = 'CD409'; end if;
  return jsonb_build_object('slot', to_jsonb(target), 'caso', candidate.caso,
    'practicaSoltadaId', p_source_slot_id, 'cancellationId', v_cancel, 'enrollmentId', e.id,
    'reprogramacionesRestantes', 2 - coalesce(v_number, e.reprogramaciones_usadas));
end;
$$;

-- CREATE OR REPLACE conserva ACL; reafirmar el contrato E1/E2.
revoke all on function private.eligible_free_slots_for_enrollment(uuid,uuid),
  private.eligible_practice_slot_changes(uuid), public.swap_practice_slot(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function private.eligible_free_slots_for_enrollment(uuid,uuid),
  private.eligible_practice_slot_changes(uuid), public.swap_practice_slot(uuid,uuid,uuid)
  to service_role;
notify pgrst, 'reload schema';
commit;
