-- Solo lectura; guardar esta salida antes de aplicar.
select current_database(),current_user;
select polname,pg_get_expr(polqual,polrelid) using_expr from pg_policy where polrelid='realtime.messages'::regclass order by polname;
select 'private.student_realtime_account_active()' signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure('private.student_realtime_account_active()');
select has_function_privilege('authenticated','private.student_realtime_account_active()','EXECUTE') authenticated_puede_ejecutar,has_table_privilege('authenticated','public.users','SELECT') authenticated_lee_users;
