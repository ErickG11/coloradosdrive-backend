-- Manual: solo despues de rollback 066b, o si 066b nunca se aplico. No tocar 065.
begin;
set local lock_timeout='5s';
do $guard_rollback_066a$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure) is distinct from '4cfb1f793a48d92124844e7acc9ac637' then raise exception 'Rollback066a: revertir 066b primero';end if;
end $guard_rollback_066a$;
drop function public.content_admin(uuid,text,jsonb);
drop function public.content_student(uuid,text,jsonb);
drop function public.content_start_attempt(uuid,uuid);
drop function public.content_finish_attempt(uuid,uuid,jsonb);
drop function public.content_exam_access(uuid,uuid);
drop function public.content_attempt_state(uuid,uuid);
drop function private.content_admin(uuid,text,jsonb);
drop function private.content_student(uuid,text,jsonb);
drop function private.content_attempt_state(uuid,uuid);
drop function private.finish_content_attempt(uuid,uuid,jsonb);

notify pgrst,'reload schema';
commit;
select '066a revertida; 065 conservada' as estado;
