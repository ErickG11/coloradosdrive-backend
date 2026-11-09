-- SOLO LECTURA: 065 ya debe existir; no volver a aplicarla.
begin read only;
select md5(replace(prosrc,chr(13),'')) delete_student_data_hash from pg_proc where oid=to_regprocedure('public.delete_student_data(uuid,uuid,timestamptz,text[])');
do $preflight_066b$ declare expected record; f regprocedure;begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.delete_student_data(uuid,uuid,timestamptz,text[])')) is distinct from '4cfb1f793a48d92124844e7acc9ac637' then raise exception '066b: borrado distinto de 060; no reemplazar';end if;
 for expected in select * from (values
  ('private.content_admin(uuid,text,jsonb)','c66224e19b0214bc471537a016f88e96',true),
  ('private.content_student(uuid,text,jsonb)','e532f5a455c093db49ebd1b00d39d157',true),
  ('private.finish_content_attempt(uuid,uuid,jsonb)','c572675ff9cf9c7e87a9866626bb0ad7',true),
  ('private.content_attempt_state(uuid,uuid)','ed582c2a8bad6d158fc53ce04679dbd9',true),
  ('public.content_attempt_state(uuid,uuid)','d4c9aef2b404c07f408f70cf0c7b20c1',false),
  ('public.content_admin(uuid,text,jsonb)','f72e3705d1dcbc999c2c41e1846731c5',false),
  ('public.content_student(uuid,text,jsonb)','0054e2ec7e7eb2967f16d43b8cd5c4b8',false),
  ('public.content_start_attempt(uuid,uuid)','39a5723aef9646a802b1f83c7c12eeb4',false),
  ('public.content_finish_attempt(uuid,uuid,jsonb)','8d6156f745216c68afffcf48a8caf49a',false),
  ('public.content_exam_access(uuid,uuid)','6879cc740d66e77fccdd219db8ed9180',false)
 ) definitions(signature,body_hash,is_definer) loop
  f:=to_regprocedure(expected.signature);
  if f is null then raise exception '066b: falta %, aplicar 066a entera',expected.signature;end if;
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=f) is distinct from expected.body_hash then raise exception '066b: cuerpo distinto en %; revisar 066a',expected.signature;end if;
  if (select prosecdef from pg_proc where oid=f) is distinct from expected.is_definer then raise exception '066b: SECURITY incorrecta en %',expected.signature;end if;
  if not exists(select 1 from pg_proc where oid=f and 'search_path=""'=any(proconfig)) then raise exception '066b: search_path incorrecto en %',expected.signature;end if;
 end loop;
end $preflight_066b$;
rollback;
