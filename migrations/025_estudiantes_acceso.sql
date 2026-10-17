-- Entrega B. Pendiente de aprobación y respaldo; ejecutar fuera de horario.
begin;
set local lock_timeout='5s';
set local search_path=pg_catalog,public,extensions,pg_temp;
lock table public.practice_slots in access exclusive mode;

-- No normalizar solapamientos existentes: la exclusión aborta el dry-run si los hay.
alter table public.practice_slots add constraint practice_slots_student_interval_excl
  exclude using gist (student_id with =,
    tsrange(scheduled_at at time zone 'UTC',
      (scheduled_at at time zone 'UTC')+interval '60 minutes','[)') with &&)
  where (student_id is not null and status in ('asignado','confirmado','completado'));

create table public.student_access_audit (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  actor_id uuid not null,
  action text not null check(action in ('desactivar','reactivar')),
  created_at timestamptz not null default now()
);
create table public.student_practice_recovery (
  student_id uuid not null references public.users(id) on delete cascade,
  slot_id uuid not null,
  cohort_id uuid not null,
  instructor_id uuid not null,
  scheduled_at timestamptz not null,
  status text not null check(status in ('cancelada_por_desactivacion','restaurada','pendiente_reprogramar')),
  reason text,
  updated_at timestamptz not null default now(),
  primary key(student_id,slot_id)
);
alter table public.student_access_audit enable row level security;
alter table public.student_practice_recovery enable row level security;
revoke all on public.student_access_audit,public.student_practice_recovery from public,anon,authenticated,service_role;
grant select,insert on public.student_access_audit to service_role;
grant select,insert,update,delete on public.student_practice_recovery to service_role;

create function public.set_student_active(p_actor uuid,p_student uuid,p_active boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_active boolean; v_slot public.practice_slots; v_now timestamptz;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  if p_active is null then raise exception 'Estado inválido' using errcode='22023'; end if;
  select activo into v_active from public.users where id=p_student and rol='estudiante' for update;
  if not found then raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
  if not p_active then
    for v_slot in select * from public.practice_slots where student_id=p_student
      and scheduled_at>clock_timestamp() and status in ('asignado','confirmado') order by id for update
    loop
      v_now:=clock_timestamp();
      if v_slot.scheduled_at<=v_now then continue; end if;
      insert into public.student_practice_recovery(student_id,slot_id,cohort_id,instructor_id,scheduled_at,status)
        values(p_student,v_slot.id,v_slot.cohort_id,v_slot.instructor_id,v_slot.scheduled_at,'cancelada_por_desactivacion')
      on conflict(student_id,slot_id) do update set cohort_id=excluded.cohort_id,
        instructor_id=excluded.instructor_id,scheduled_at=excluded.scheduled_at,
        status='cancelada_por_desactivacion',reason=null,updated_at=now();
      update public.practice_slots set student_id=null,status='liberado',attended=null,
        confirmed_at=null,confirmation_notified_at=null,release_notified_at=v_now where id=v_slot.id;
    end loop;
  end if;
  if v_active is distinct from p_active then
    update public.users set activo=p_active where id=p_student;
    insert into public.student_access_audit(student_id,actor_id,action)
      values(p_student,p_actor,case when p_active then 'reactivar' else 'desactivar' end);
  end if;
  return true;
end;
$$;

-- Conservar la lógica de reserva actual en esquema no expuesto; el wrapper exige cuenta activa.
alter function public.act_on_practice_slot(uuid,uuid,text) set schema private;
alter function private.act_on_practice_slot(uuid,uuid,text) rename to book_practice_slot;
grant usage on schema private to service_role;
create function public.act_on_practice_slot(p_slot_id uuid,p_student_id uuid,p_action text)
returns setof public.practice_slots language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_student_id and rol='estudiante' and activo for share;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode='CD403'; end if;
  return query select * from private.book_practice_slot(p_slot_id,p_student_id,p_action);
end;
$$;

create function public.restore_student_practice(p_actor uuid,p_student uuid,p_slot uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.student_practice_recovery; s public.practice_slots; v_reason text;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501';
  end if;
  perform 1 from public.users where id=p_student and rol='estudiante' and activo for share;
  if not found then raise exception 'Cuenta inactiva' using errcode='CD403'; end if;
  select * into r from public.student_practice_recovery where student_id=p_student and slot_id=p_slot for update;
  if not found then return jsonb_build_object('slotId',p_slot,'status','sin_registro'); end if;
  if r.status='restaurada' then return jsonb_build_object('slotId',p_slot,'status',r.status); end if;
  select * into s from public.practice_slots where id=p_slot for update;
  if not found then v_reason:='franja_eliminada';
  elsif r.scheduled_at<=clock_timestamp() then v_reason:='pasada';
  elsif s.instructor_id<>r.instructor_id or s.cohort_id<>r.cohort_id or s.scheduled_at<>r.scheduled_at then v_reason:='franja_modificada';
  elsif s.student_id is not null or s.status not in ('disponible','liberado') then v_reason:='ocupada';
  elsif not exists(select 1 from public.users where id=s.instructor_id and rol='instructor' and activo) then v_reason:='instructor_no_disponible';
  else
    begin
      perform * from public.act_on_practice_slot(p_slot,p_student,'claim');
    exception
      when exclusion_violation then v_reason:='solapamiento_alumno';
      when sqlstate 'CD023' then v_reason:='instructor_no_disponible';
      when sqlstate 'CD403' then v_reason:='matricula_no_vigente';
      when sqlstate 'CD409' then v_reason:='ventana_cerrada';
      when others then v_reason:='error_reserva';
    end;
  end if;
  update public.student_practice_recovery set
    status=case when v_reason is null then 'restaurada' else 'pendiente_reprogramar' end,
    reason=v_reason,updated_at=now() where student_id=p_student and slot_id=p_slot;
  return jsonb_build_object('slotId',p_slot,'status',case when v_reason is null then 'restaurada' else 'pendiente_reprogramar' end,'reason',v_reason);
end;
$$;

-- Cerrar asignaciones admin que ya estaban en vuelo al desactivar.
create or replace function public.enforce_practice_slot_student_role()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_role public.user_role; v_active boolean;
begin
  if new.student_id is null then return new; end if;
  if TG_OP='UPDATE' then
    if new.student_id is not distinct from old.student_id then return new; end if;
  end if;
  select rol,activo into v_role,v_active from public.users where id=new.student_id for share;
  if v_role is distinct from 'estudiante' or not v_active then
    raise exception 'Cuenta de alumno inactiva o inexistente' using errcode='CD403';
  end if;
  return new;
end;
$$;

-- Helpers DEFINER privados: authenticated no tiene SELECT sobre users/enrollments.
create function private.student_realtime_account_active()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.users where id=(select auth.uid()) and activo);
$$;
create or replace function private.can_subscribe_cohort_channel(p_topic text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.student_realtime_account_active() and (
    exists(select 1 from public.users where id=(select auth.uid()) and rol='admin')
    or exists(select 1 from public.enrollments where student_id=(select auth.uid()) and status='activo'
      and lower(cohort_id::text)=lower(substring(p_topic from '^cohort-([0-9a-fA-F-]{36})-practice-slots$')))
    or exists(select 1 from public.practice_slots where instructor_id=(select auth.uid())
      and lower(cohort_id::text)=lower(substring(p_topic from '^cohort-([0-9a-fA-F-]{36})-practice-slots$')))
  ) and p_topic ~ '^cohort-[0-9a-fA-F-]{36}-practice-slots$';
$$;
alter policy "user-practice-slots: solo el propio usuario" on realtime.messages using (
  private.student_realtime_account_active() and realtime.topic()='user-'||(select auth.uid())::text||'-practice-slots'
);

revoke all on function public.set_student_active(uuid,uuid,boolean),
  public.restore_student_practice(uuid,uuid,uuid),public.act_on_practice_slot(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.set_student_active(uuid,uuid,boolean),
  public.restore_student_practice(uuid,uuid,uuid),public.act_on_practice_slot(uuid,uuid,text) to service_role;
revoke all on function private.student_realtime_account_active() from public,anon;
grant execute on function private.student_realtime_account_active() to authenticated;
notify pgrst,'reload schema';
commit;
