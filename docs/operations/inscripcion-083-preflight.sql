begin read only;
select id,enrollment_waitlist from public.users where enrollment_waitlist<>'{}';
rollback;
