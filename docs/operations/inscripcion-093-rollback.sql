begin;
set local lock_timeout='5s';
drop policy if exists notifications_broadcast_v14 on realtime.messages;
create policy notifications_broadcast_v14 on realtime.messages for select to authenticated using(extension='broadcast' and realtime.topic()='user-'||auth.uid()::text||'-notifications' and exists(select 1 from public.users where id=auth.uid() and activo));
notify pgrst, 'reload schema';
commit;
