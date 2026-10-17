-- Reversión manual de 025, solo con autorización y fuera de horario.
-- Retirar primero las acciones B del backend y detener peticiones/scheduler.
-- Conservar auditoría, recuperación, activo y bans: no reactivar ni reasignar.
-- No reejecutar 025 después: sus tablas se conservan deliberadamente.
-- El permiso sobre realtime.messages debe probarse en el dry-run real.
begin;
set local lock_timeout = '5s';
lock table public.practice_slots in access exclusive mode;

drop function if exists public.restore_student_practice(uuid,uuid,uuid);
drop function if exists public.set_student_active(uuid,uuid,boolean);

-- Si ya se revirtió o 025 nunca se aplicó, no borrar la función original.
-- ALTER FUNCTION no admite IF EXISTS: comprobar su firma antes de moverla.
do $$
begin
  if to_regprocedure('private.book_practice_slot(uuid,uuid,text)') is not null then
    drop function if exists public.act_on_practice_slot(uuid,uuid,text);
    alter function private.book_practice_slot(uuid,uuid,text) rename to act_on_practice_slot;
    alter function private.act_on_practice_slot(uuid,uuid,text) set schema public;
  end if;
end;
$$;
revoke all on function public.act_on_practice_slot(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.act_on_practice_slot(uuid,uuid,text) to service_role;

-- Restaurar la función del trigger tal como en 020 (el trigger sigue instalado).
create or replace function public.enforce_practice_slot_student_role()
returns trigger language plpgsql security invoker set search_path='' as $$
declare student_role public.user_role;
begin
  if new.student_id is null then return new; end if;
  select rol into student_role from public.users where id=new.student_id;
  if student_role is distinct from 'estudiante' then
    raise exception 'practice_slots.student_id (%) must reference a user with rol = estudiante', new.student_id;
  end if;
  return new;
end;
$$;

-- Restaurar helper y políticas SELECT/USING de 011; no cambiar owner ni RLS.
create or replace function private.can_subscribe_cohort_channel(p_topic text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_uid text := (select auth.uid())::text;
  v_cohort_id text := lower(substring(p_topic from '^cohort-([0-9a-fA-F-]{36})-practice-slots$'));
begin
  if v_uid is null or v_cohort_id is null then return false; end if;
  return exists(select 1 from public.users u where u.id::text=v_uid and u.rol='admin')
    or exists(select 1 from public.enrollments e where e.student_id::text=v_uid
      and e.status='activo' and lower(e.cohort_id::text)=v_cohort_id)
    or exists(select 1 from public.practice_slots ps where ps.instructor_id::text=v_uid
      and lower(ps.cohort_id::text)=v_cohort_id);
end;
$$;
revoke all on function private.can_subscribe_cohort_channel(text) from public,anon;
grant execute on function private.can_subscribe_cohort_channel(text) to authenticated;

drop policy if exists "user-practice-slots: solo el propio usuario" on realtime.messages;
create policy "user-practice-slots: solo el propio usuario" on realtime.messages
for select to authenticated using (
  realtime.topic()='user-'||(select auth.uid())::text||'-practice-slots'
);
drop policy if exists "cohort-practice-slots: admin, instructor de la cohorte o estudi" on realtime.messages;
create policy "cohort-practice-slots: admin, instructor de la cohorte o estudi" on realtime.messages
for select to authenticated using (private.can_subscribe_cohort_channel(realtime.topic()));
drop function if exists private.student_realtime_account_active();

alter table if exists public.practice_slots
  drop constraint if exists practice_slots_student_interval_excl;
-- No eliminar extensiones, esquemas, grants compartidos ni tablas de B.
notify pgrst,'reload schema';
commit;
