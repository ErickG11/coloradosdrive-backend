-- C18. Aplicación manual. Requiere aplicadas la 001 a la 092.
begin;
set local lock_timeout='5s';
do $guard$ declare h text;begin select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure('private.student_realtime_account_active()');if h is null or h is distinct from '06ce7ad81b5af41a2e1999f1c7708946' then raise exception 'GUARDA_093: no coincide con la instalación esperada: private.student_realtime_account_active()';end if;if to_regclass('realtime.messages') is null then raise exception 'GUARDA_093: falta realtime.messages';end if;end $guard$;
-- authenticated no tiene SELECT sobre public.users: la condición de usuario activo usa el helper DEFINER privado.
drop policy if exists notifications_broadcast_v14 on realtime.messages;
create policy notifications_broadcast_v14 on realtime.messages for select to authenticated using(extension='broadcast' and realtime.topic()='user-'||(select auth.uid())::text||'-notifications' and (select private.student_realtime_account_active()));
notify pgrst, 'reload schema';
commit;
