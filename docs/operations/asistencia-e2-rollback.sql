-- Reversión manual de 031: retirar E2 del backend antes.
-- Preserva la auditoría: si E2 ya se usó, preparar una migración de avance.
begin;
set local lock_timeout = '5s';
lock table public.practice_slot_cancellations in access exclusive mode;
do $$
begin
  if exists(select 1 from public.practice_slot_cancellations
    where origen <> 'alumno' or repuesto_en is not null or repuesto_por_slot_id is not null) then
    raise exception 'No se puede revertir 031: existen cambios o reposiciones auditados';
  end if;
end $$;

-- Restauración exacta del wrapper de 030; no modifica guards ni helper privado.
create or replace function public.act_on_practice_slot(p_slot_id uuid, p_student_id uuid, p_action text)
returns setof public.practice_slots language plpgsql security invoker set search_path = '' as $$
begin
  if p_action is null or p_action not in ('claim', 'confirm') then
    raise exception 'La cancelación requiere motivo; utiliza cancel_practice_slot_with_reason' using errcode = '22023'; end if;
  perform 1 from public.users where id = p_student_id and rol = 'estudiante' and activo for share;
  if not found then raise exception 'Cuenta de alumno inactiva o inexistente' using errcode = 'CD403'; end if;
  -- Reclamar sigue el orden matrícula -> franja usado por la nueva cancelación.
  if p_action = 'claim' then
    perform 1 from public.enrollments e join public.practice_slots s on s.cohort_id = e.cohort_id
      where s.id = p_slot_id and e.student_id = p_student_id and e.status = 'activo' for share of e;
  end if;
  return query select * from private.book_practice_slot(p_slot_id, p_student_id, p_action);
end;
$$;

drop function public.swap_practice_slot(uuid,uuid,uuid);
drop function public.pending_practice_slots_for_student(uuid);
drop function public.released_practice_slots_for_student(uuid);
drop function private.eligible_practice_slot_changes(uuid);
drop function private.pending_practice_slots(uuid);
drop function private.practice_replacement_balance(uuid);
alter table public.practice_slot_cancellations
  drop constraint practice_slot_cancellations_replacement_check,
  drop column origen, drop column repuesto_por_slot_id, drop column repuesto_en;
notify pgrst, 'reload schema';
commit;
