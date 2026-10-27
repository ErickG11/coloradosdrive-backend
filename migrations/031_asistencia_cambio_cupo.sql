-- RF-03 E2. Aplicación MANUAL después de asistencia-e2-preflight.sql.
-- 031 libre en migrations/ y en los borradores de docs/operations.
begin;
set local lock_timeout = '5s';

alter table public.practice_slot_cancellations
  add column origen text not null default 'alumno'
    check (origen in ('alumno', 'cambio_cupo')),
  -- Instantáneas de auditoría, sin FK al slot reutilizable/eliminable.
  add column repuesto_por_slot_id uuid,
  add column repuesto_en timestamptz,
  add constraint practice_slot_cancellations_replacement_check check (
    (repuesto_por_slot_id is null and repuesto_en is null and origen = 'alumno')
    or (repuesto_por_slot_id is not null and repuesto_en is not null and resultado = 'reprogramable')
  );
-- Las filas nuevas siguen usando las seis categorías de E1; el origen es independiente.
grant update (repuesto_por_slot_id, repuesto_en) on public.practice_slot_cancellations to service_role;

create function private.practice_replacement_balance(p_enrollment_id uuid)
returns table(horas_objetivo integer, horas_por_dia integer, horas_sin_programar integer, reposiciones_pendientes integer)
language plpgsql stable security invoker set search_path = '' as $$
declare e public.enrollments; v_hours text; v_daily text; v_programmed integer; v_credits integer;
begin
  select * into e from public.enrollments where id = p_enrollment_id;
  if not found then raise exception 'Matrícula no encontrada' using errcode = 'CD404'; end if;
  v_hours := coalesce(e.horas_practica_objetivo::text, e.practice_plan->>'horas');
  v_daily := e.practice_plan->>'horasPorDia';
  if v_hours is null or v_daily is null then
    raise exception 'La matrícula no tiene horas objetivo u horas por día válidas; requiere revisión' using errcode = 'CD409';
  end if;
  begin
    horas_objetivo := v_hours::integer;
    horas_por_dia := v_daily::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'La matrícula no tiene horas objetivo u horas por día válidas; requiere revisión' using errcode = 'CD409';
  end;
  if horas_objetivo <= 0 or horas_por_dia not between 1 and 16 then
    raise exception 'La matrícula no tiene horas objetivo u horas por día válidas; requiere revisión' using errcode = 'CD409';
  end if;
  select coalesce(sum(s.duration_minutes), 0) / 60 into v_programmed
    from public.practice_slots s where s.student_id = e.student_id and s.cohort_id = e.cohort_id
      and s.status in ('asignado', 'confirmado', 'completado');
  select count(*) into v_credits from public.practice_slot_cancellations c
    where c.enrollment_id = e.id and c.resultado = 'reprogramable'
      and c.origen = 'alumno' and c.repuesto_en is null;
  horas_sin_programar := greatest(horas_objetivo - v_programmed, 0);
  -- Un hueco por falta/hora_perdida nunca crea por sí solo derecho a reposición.
  reposiciones_pendientes := least(horas_sin_programar, v_credits);
  return next;
end;
$$;

create function private.pending_practice_slots(p_enrollment_id uuid)
returns setof public.practice_slots language sql stable security invoker set search_path = '' as $$
  select s.* from public.practice_slots s join public.enrollments e
    on e.student_id = s.student_id and e.cohort_id = s.cohort_id
    join public.users u on u.id = e.student_id and u.rol = 'estudiante' and u.activo
  where e.id = p_enrollment_id and e.status = 'activo'
    and s.status in ('asignado', 'confirmado') and s.scheduled_at > clock_timestamp()
  order by s.scheduled_at, s.id;
$$;

create function private.eligible_practice_slot_changes(p_enrollment_id uuid)
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
      where (select coalesce(sum(own.duration_minutes), 0) from public.practice_slots own
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

create function public.released_practice_slots_for_student(p_student_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists(select 1 from public.users where id = p_student_id and rol = 'estudiante' and activo) then
    raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', (c.slot).id, 'cohortId', e.cohort_id,
    'enrollmentId', e.id, 'scheduledAt', (c.slot).scheduled_at, 'durationMinutes', (c.slot).duration_minutes,
    'status', (c.slot).status, 'caso', c.caso, 'via', case c.caso when 'A' then 'reposicion' else 'cambio' end,
    'practicasASoltarIds', c.source_slot_ids, 'reprogramacionesRestantes', 2 - e.reprogramaciones_usadas)
    order by (c.slot).scheduled_at, (c.slot).id), '[]'::jsonb) into v_result
  from public.enrollments e cross join lateral private.eligible_practice_slot_changes(e.id) c
  where e.student_id = p_student_id and e.status = 'activo';
  return v_result;
end;
$$;

create function public.pending_practice_slots_for_student(p_student_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists(select 1 from public.users where id = p_student_id and rol = 'estudiante' and activo) then
    raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('slot', to_jsonb(s), 'enrollmentId', e.id)
    order by s.scheduled_at, s.id), '[]'::jsonb) into v_result
  from public.enrollments e cross join lateral private.pending_practice_slots(e.id) s
  cross join lateral private.practice_replacement_balance(e.id) b
  where e.student_id = p_student_id and e.status = 'activo'
    and e.reprogramaciones_usadas < 2 and b.reposiciones_pendientes = 0;
  return v_result;
end;
$$;

create function public.swap_practice_slot(p_slot_id uuid, p_student_id uuid, p_source_slot_id uuid default null)
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

-- Cierra el bypass antiguo: claim sin origen solo puede servir para el caso A.
-- El helper privado book_practice_slot sigue reservado a recuperación administrativa.
create or replace function public.act_on_practice_slot(p_slot_id uuid, p_student_id uuid, p_action text)
returns setof public.practice_slots language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if p_action = 'claim' then
    v_result := public.swap_practice_slot(p_slot_id, p_student_id, null);
    return query select * from jsonb_populate_record(null::public.practice_slots, v_result->'slot');
    return;
  end if;
  if p_action is distinct from 'confirm' then
    raise exception 'La cancelación requiere motivo; utiliza cancel_practice_slot_with_reason' using errcode = '22023'; end if;
  perform 1 from public.users where id = p_student_id and rol = 'estudiante' and activo for share;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  return query select * from private.book_practice_slot(p_slot_id, p_student_id, p_action);
end;
$$;

revoke all on function private.practice_replacement_balance(uuid), private.pending_practice_slots(uuid),
  private.eligible_practice_slot_changes(uuid), public.released_practice_slots_for_student(uuid),
  public.pending_practice_slots_for_student(uuid), public.swap_practice_slot(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.practice_replacement_balance(uuid), private.pending_practice_slots(uuid),
  private.eligible_practice_slot_changes(uuid), public.released_practice_slots_for_student(uuid),
  public.pending_practice_slots_for_student(uuid), public.swap_practice_slot(uuid, uuid, uuid) to service_role;

-- No tablas nuevas: delete_student_data de 030 ya borra TODA la fila del historial,
-- incluidos origen y referencias de reposición. Mantener sus guards intactos.
notify pgrst, 'reload schema';
commit;
