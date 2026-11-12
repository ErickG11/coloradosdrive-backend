begin;
set local lock_timeout='5s';
do $$ begin
 if exists(select 1 from public.enrollment_rule_flags where enabled or(implemented and key in('schedule_changes','billing','identity','foreign_identity','permissions','metrics'))) then raise exception 'Revertir 077/lotes posteriores y apagar indicadores';end if;
 if exists(select 1 from public.student_schedule_reservations where replacement_enrollment_id is not null and estado in ('vigente','pago_en_curso')) then raise exception 'Resolver cambios pendientes; no borrar reservas ni prácticas';end if;
 if exists(select 1 from public.notifications where tipo='plan_cambiado' and email_status='pendiente') then raise exception 'Resolver correos de cambio pendientes';end if;
end $$;
drop function public.reserve_student_plan_change_v2(uuid,uuid,jsonb);
drop function public.confirm_student_plan_change_v2(uuid,uuid);
drop function public.preview_student_plan_change_v2(uuid,uuid,jsonb);
drop function public.student_plan_change_calendar_v2(uuid,uuid,date,text,integer);
drop function public.student_plan_change_state_v2(uuid,uuid);
drop function public.manage_student_reservation(uuid,text,uuid,integer,integer,integer);
alter function public.legacy076_manage_student_reservation(uuid,text,uuid,integer,integer,integer) rename to manage_student_reservation;
drop function public.expire_student_reservations(uuid);
alter function public.legacy076_expire_student_reservations(uuid) rename to expire_student_reservations;
drop function public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text);
alter function public.legacy076_begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text) rename to begin_student_payment;
drop function private.reservation_json_v2(uuid);
alter function private.legacy076_reservation_json_v2(uuid) rename to reservation_json_v2;
drop function private.vehicle_occupation_v2(timestamptz,uuid,uuid);
alter function private.legacy076_vehicle_occupation_v2(timestamptz,uuid,uuid) rename to vehicle_occupation_v2;
-- Conserva columnas/historia y payments_00_dates_proven: es una corrección de
-- evidencia de L5, no una activación de cambios ni un backfill de históricos.
notify pgrst,'reload schema';
commit;
