-- MANUAL: se niega a destruir datos de reserva. Primero resolver pagos/reservas.
begin;
set local lock_timeout='5s';
do $$ begin
 if exists(select 1 from public.student_schedule_reservations) or exists(select 1 from public.student_schedule_daily) then
 raise exception '059 contiene datos: conservar historial y revisar rollback con operador';end if;
end $$;
drop trigger cohorts_schedule_reservations on public.cohorts;
drop trigger users_release_schedule_reservations on public.users;
drop trigger practice_slots_00_schedule_holds on public.practice_slots;
drop function public.student_schedule_free_slots(timestamptz[]),public.guard_cohort_schedule_reservations(),public.release_inactive_student_reservations(),public.guard_practice_schedule_holds();
drop function public.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer),
 public.manage_student_reservation(uuid,text,uuid,integer,integer,integer),public.expire_student_reservations(uuid),
 private.confirm_student_reservation(uuid,uuid),private.close_student_reservation(uuid,text),private.student_reservation_json(uuid);
create or replace function public.practice_free_instructors(
  p_scheduled_ats timestamptz[], p_instructor_id uuid default null
)
returns table(id uuid, nombre_completo text)
language sql stable security invoker set search_path = ''
as $$
  select u.id, u.nombre_completo::text from public.users u
  where u.rol = 'instructor' and u.activo
    and (p_instructor_id is null or u.id = p_instructor_id)
    and cardinality(p_scheduled_ats) > 0
    and not exists (
      select 1 from public.practice_slots s cross join unnest(p_scheduled_ats) requested(start_at)
      where s.instructor_id = u.id
        and s.status in ('disponible', 'asignado', 'confirmado', 'liberado', 'completado')
        and tsrange(s.scheduled_at at time zone 'UTC',
                    (s.scheduled_at at time zone 'UTC') + interval '60 minutes', '[)')
         && tsrange(requested.start_at at time zone 'UTC',
                    (requested.start_at at time zone 'UTC') + interval '60 minutes', '[)')
    )
  order by u.nombre_completo, u.id;
$$;
revoke all on function public.practice_free_instructors(timestamptz[], uuid) from public, anon, authenticated;
grant execute on function public.practice_free_instructors(timestamptz[], uuid) to service_role;

drop table public.student_schedule_events,public.student_schedule_holds,public.student_schedule_daily,public.student_schedule_reservations;
notify pgrst,'reload schema';
commit;
