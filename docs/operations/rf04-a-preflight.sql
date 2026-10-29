-- SOLO LECTURA, SQL Editor, antes de 035. Ultima local: 034.
-- Firmas/cuerpos reales de 030 y 034; abortar ante drift.
do $rf04$ declare sig text; expected text; actual text;
begin
 if to_regclass('public.practice_ratings') is not null or to_regclass('private.practice_rating_rollout') is not null then raise exception '035 ya existe total o parcialmente'; end if;
 foreach sig in array array[
 'public.register_practice_attendance(uuid,uuid,boolean)', 'public.correct_practice_attendance(uuid,uuid,boolean,text)',
 'private.guard_student_deletion_write()', 'private.assert_student_not_deleting(uuid)', 'private.trim_attendance_reason(text)',
 'private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)', 'private.enqueue_attendance_correction(uuid)',
 'private.attendance_correction_window_open(timestamptz,integer,timestamptz)', 'public.begin_student_deletion(uuid,uuid,text)',
 'public.advance_student_deletion(uuid,uuid,text,timestamptz,text)',
 'public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'] loop
 if to_regprocedure(sig) is null then raise exception 'Falta dependencia: %', sig; end if; end loop;
 foreach sig in array array['public.users','public.practice_slots','public.practice_attendance_events','public.notifications',
 'public.student_deletion_operations','public.practice_slot_cancellations'] loop
 if to_regclass(sig) is null then raise exception 'Falta tabla: %', sig; end if; end loop;
 sig := 'private.write_practice_attendance(uuid,uuid,boolean,boolean,text)'; expected := '87a885c0e9275c571a0cb24021a28a47';
 select md5(replace(prosrc, E'\r', '')) into actual from pg_proc where oid=to_regprocedure(sig);
 if actual is distinct from expected then raise exception 'Cuerpo inesperado de %; requiere version del repo 030/034',sig; end if;
 sig := 'public.delete_student_data(uuid,uuid,timestamptz,text[])'; expected := '98b197963ee227e342ad719bfa92a0b6';
 select md5(replace(prosrc, E'\r', '')) into actual from pg_proc where oid=to_regprocedure(sig);
 if actual is distinct from expected then raise exception 'Cuerpo inesperado de %; requiere version del repo 030/034',sig; end if;
 for sig, expected in select * from (values
   ('private.assert_student_not_deleting(uuid)', '13eea320880cd7c9f7d053f6d28f4933'),
   ('private.guard_student_deletion_write()', '90af686ae49185f0727e86bde541971b'),
   ('private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)', 'e5502b68a382ae3c5d59970c2fb0cb43')
 ) required(signature, body_hash) loop
   select md5(replace(prosrc, E'\r', '')) into actual from pg_proc where oid=to_regprocedure(sig);
   if actual is distinct from expected then raise exception 'Dependencia modificada: %; revisar antes de aplicar',sig; end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.practice_slots'::regclass and tgname='practice_slots_attendance_audit' and tgenabled='O') then raise exception 'Falta trigger de auditoria 034'; end if;
 if to_regclass('public.notifications_automatic_unique') is null then raise exception 'Falta indice 034'; end if;
end; $rf04$;

do $rf04_columns$
declare dep record;
begin
  for dep in select * from (values
    ('public.practice_slots','id','uuid'), ('public.practice_slots','student_id','uuid'),
    ('public.practice_slots','instructor_id','uuid'), ('public.practice_slots','cohort_id','uuid'),
    ('public.practice_slots','scheduled_at','timestamptz'), ('public.practice_slots','duration_minutes','integer'),
    ('public.practice_slots','status','public.practice_slot_status'), ('public.practice_slots','attended','boolean'),
    ('public.practice_attendance_events','id','uuid'), ('public.practice_attendance_events','slot_id','uuid'),
    ('public.practice_attendance_events','student_id','uuid'), ('public.practice_attendance_events','instructor_id','uuid'),
    ('public.practice_attendance_events','cohort_id','uuid'), ('public.practice_attendance_events','scheduled_at','timestamptz'),
    ('public.practice_attendance_events','duration_minutes','integer'), ('public.practice_attendance_events','created_at','timestamptz'),
    ('public.practice_attendance_events','transaction_id','bigint'), ('public.practice_attendance_events','motivo','text'),
    ('public.practice_attendance_events','tipo','text'), ('public.practice_attendance_events','previous_attended','boolean'),
    ('public.practice_attendance_events','new_attended','boolean'),
    ('public.notifications','user_id','uuid'), ('public.notifications','tipo','text'),
    ('public.notifications','practice_slot_id','uuid'), ('public.notifications','attendance_event_id','uuid'),
    ('public.notifications','email_status','text'),
    ('public.student_deletion_operations','student_id','uuid'), ('public.student_deletion_operations','phase','text'),
    ('public.student_deletion_operations','status','text'), ('public.student_deletion_operations','updated_at','timestamptz')
  ) required(relation_name, column_name, type_name) loop
    if not exists(select 1 from pg_attribute where attrelid=to_regclass(dep.relation_name)
      and attname=dep.column_name and not attisdropped and atttypid=to_regtype(dep.type_name)) then
      raise exception 'Columna faltante o tipo inesperado: %.% (%)',dep.relation_name,dep.column_name,dep.type_name;
    end if;
  end loop;
  if exists(select 1 from pg_proc where oid in (
    'private.write_practice_attendance(uuid,uuid,boolean,boolean,text)'::regprocedure,
    'public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure,
    'private.guard_student_deletion_write()'::regprocedure) and prosecdef) then
    raise exception 'Se esperaba SECURITY INVOKER en las dependencias'; end if;
end;
$rf04_columns$;
select oid::regprocedure as firma, pg_get_function_result(oid) as resultado, prosecdef, proconfig, pg_get_functiondef(oid)
from pg_proc where oid in ('private.write_practice_attendance(uuid,uuid,boolean,boolean,text)'::regprocedure,
 'public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure,
 'private.guard_student_deletion_write()'::regprocedure, 'private.assert_student_not_deleting(uuid)'::regprocedure,
 'private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)'::regprocedure);
select table_schema,table_name,column_name,data_type,is_nullable from information_schema.columns
where table_schema='public' and table_name in ('practice_slots','practice_attendance_events','notifications','student_deletion_operations')
order by table_name,ordinal_position;
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.notifications'::regclass,'public.practice_slots'::regclass);
select indexdef from pg_indexes where schemaname='public' and indexname in ('notifications_automatic_unique','notifications_attendance_event_unique');
select has_table_privilege('service_role','public.notifications','insert') as bandeja,
 has_table_privilege('service_role','public.practice_slots','update') as franjas,
 has_table_privilege('service_role','public.practice_attendance_events','insert') as auditoria,
 has_schema_privilege('service_role','private','usage') as esquema_privado;
-- Cero filas; no corregir automaticamente datos previos.
select id,scheduled_at,duration_minutes,status,attended from public.practice_slots
where (status='completado' and scheduled_at+make_interval(mins=>duration_minutes)>clock_timestamp())
 or (attended is not null and status<>'completado');
do $$ declare latest text; begin
 if to_regclass('supabase_migrations.schema_migrations') is not null then
 execute 'select max(version::text) from supabase_migrations.schema_migrations' into latest;
 raise notice 'Ultima version registrada: %. Comparar manualmente con 034 y SQL aplicado sin historial.',latest;
 else raise notice 'Sin historial administrado: comprobar 030..034 aplicadas y ninguna 035 ajena.'; end if;
end $$;
