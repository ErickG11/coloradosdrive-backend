begin;
set local lock_timeout='5s';
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled or(implemented and key not in ('date_rules','capacity','reservations','prices'))) then raise exception 'Revertir lotes posteriores y apagar indicadores';end if;
 if exists(select 1 from public.student_schedule_holds where payment_protected and released_at is null)
   or exists(select 1 from public.student_schedule_reservations where admission_rule_version='070' and estado in ('vigente','pago_en_curso')) then raise exception 'Resolver reservas/pagos nuevos antes de revertir; no se libera ni borra nada';end if;
end $$;
drop function public.student_schedule_calendar_v2(uuid,uuid,date,text,integer);
drop function public.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer);
alter function private.legacy071_reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer) rename to reserve_student_schedule;
alter function private.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer) set schema public;
drop function public.manage_student_reservation(uuid,text,uuid,integer,integer,integer);
alter function private.legacy071_manage_student_reservation(uuid,text,uuid,integer,integer,integer) rename to manage_student_reservation;
alter function private.manage_student_reservation(uuid,text,uuid,integer,integer,integer) set schema public;
drop function public.expire_student_reservations(uuid);
alter function private.legacy071_expire_student_reservations(uuid) rename to expire_student_reservations;
alter function private.expire_student_reservations(uuid) set schema public;
drop trigger practice_slots_00_schedule_holds on public.practice_slots;
drop function public.guard_practice_schedule_holds();
alter function public.legacy071_guard_practice_schedule_holds() rename to guard_practice_schedule_holds;
create trigger practice_slots_00_schedule_holds before insert or update of scheduled_at,instructor_id,cohort_id,status
 on public.practice_slots for each row execute function public.guard_practice_schedule_holds();
drop trigger enrollments_enforce_cupo on public.enrollments;
drop function public.enforce_cohort_cupo();
alter function public.legacy071_enforce_cohort_cupo() rename to enforce_cohort_cupo;
create trigger enrollments_enforce_cupo before insert or update of cohort_id,status,etapa_inscripcion,reserva_expira_at
 on public.enrollments for each row execute function public.enforce_cohort_cupo();
drop trigger users_release_schedule_reservations on public.users;
drop function public.release_inactive_student_reservations();
alter function public.legacy071_release_inactive_student_reservations() rename to release_inactive_student_reservations;
create trigger users_release_schedule_reservations after update of activo on public.users for each row execute function public.release_inactive_student_reservations();
drop index public.student_schedule_one_live;
create unique index student_schedule_one_live on public.student_schedule_reservations(student_id) where estado in ('vigente','pago_en_curso');
alter table public.student_schedule_holds drop constraint schedule_holds_resource_exclusion;
alter table public.student_schedule_holds add constraint schedule_holds_legacy_exclusion exclude using gist(
 instructor_id with =,
 tsrange(scheduled_at at time zone 'UTC',(scheduled_at at time zone 'UTC')+interval '1 hour','[)') with &&,
 tstzrange(held_from,expira_at,'[)') with &&) where(released_at is null);
update public.enrollment_rule_flags set enabled=false,implemented=false where key in ('capacity','reservations','prices');
notify pgrst,'reload schema';
commit;
