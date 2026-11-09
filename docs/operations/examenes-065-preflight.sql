-- SOLO LECTURA. Ejecutar entero antes de 065. No aplica migraciones.
begin read only;
select 'courses' objeto,count(*) filas from public.courses union all
 select 'exams',count(*) from public.exams union all select 'exam_attempts',count(*) from public.exam_attempts;
-- DEBE devolver cero filas. No borrar ni finalizar intentos sin revisión del administrador.
select student_id,exam_id,count(*) from public.exam_attempts where status='en_progreso' group by student_id,exam_id having count(*)>1;
select status,count(*) from public.exam_attempts group by status;
select tipo,count(*) from public.notifications group by tipo;
select e.id,e.title,count(q.id) preguntas from public.exams e left join public.questions q on q.exam_id=e.id group by e.id;
select n.nspname,p.proname,md5(replace(p.prosrc,chr(13),'')) body_hash
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.oid in (to_regprocedure('public.delete_student_data(uuid,uuid,timestamptz,text[])'),
 to_regprocedure('public.enforce_attempt_student_role()'),to_regprocedure('public.enforce_option_question_type()'));
do $$begin
 if to_regclass('public.course_subjects') is not null or to_regclass('public.course_materials') is not null
 or to_regclass('public.subject_items') is not null or to_regclass('public.item_access_rules') is not null
 or to_regclass('public.material_progress') is not null or to_regclass('public.content_access_audit') is not null
 or to_regclass('private.content_upload_limits') is not null then raise exception '065: ya existen objetos del módulo; revisar antes de continuar';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and
 ((table_name='exams' and column_name in ('max_attempts_default','shuffle_questions','shuffle_options','description'))
 or (table_name='exam_attempts' and column_name in ('attempt_number','deadline_at','max_attempts_aplicado','minutos_aplicados')))) then raise exception '065: columnas ya existentes';end if;
 if exists(select 1 from public.exam_attempts where status='en_progreso' group by student_id,exam_id having count(*)>1) then
  raise exception '065: intentos en progreso duplicados; detener aplicación';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='enrollments' and column_name='etapa_inscripcion')
 or to_regclass('public.notifications') is null or to_regclass('public.student_deletion_operations') is null
 or to_regclass('public.practice_ratings') is null or to_regclass('public.payments') is null then raise exception '065: faltan dependencias hasta 063';end if;
 if to_regprocedure('public.enforce_attempt_student_role()') is null or to_regprocedure('public.enforce_option_question_type()') is null then raise exception '065: faltan triggers de 004';end if;
 if exists(select 1 from storage.buckets where id='course-content') then raise exception '065: bucket ya existe';end if;
 if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then raise exception '065: Storage requiere RLS activa';end if;
 if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='course_content_backend_only') then raise exception '065: política de protección ya existe';end if;
end $$;
select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects';
-- Cada curso recibirá una materia OCULTA; cada examen existente, un item.
select count(*) materias_ocultas_a_crear from public.courses;
select count(*) items_a_crear from public.exams;
rollback;
