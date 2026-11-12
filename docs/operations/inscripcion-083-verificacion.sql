begin read only;
select waitlist_expiry_days,waitlist_daily_limit from public.app_settings;
select indexname from pg_indexes where indexname in('notifications_waitlist_daily_queue','notifications_waitlist_daily_dispatch');
rollback;
