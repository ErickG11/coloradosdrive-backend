-- SOLO datos de prueba: editar el prefijo literal de abajo. No usar con materias reales.
-- Ejecutar entero como propietario en SQL Editor, con el backend en mantenimiento.
-- Por defecto NO persiste cambios: termina en ROLLBACK. Revisar los conteos y,
-- para confirmar, volver a ejecutar entero cambiando SOLO el ROLLBACK final a COMMIT.
-- No borrar archivos del bucket tras un ensayo con ROLLBACK: siguen referenciados.
begin;
set local lock_timeout='5s';
create temp table content_cleanup_params(prefix text not null check(char_length(btrim(prefix))>0)) on commit drop;
insert into content_cleanup_params values('TEST ');

create temp table content_cleanup_subjects(id uuid primary key) on commit drop;
do $$ declare v_subject record;begin
 for v_subject in select s.id from public.course_subjects s cross join content_cleanup_params p
  where left(s.title,char_length(p.prefix))=p.prefix order by s.id for update of s loop
  insert into content_cleanup_subjects values(v_subject.id);
 end loop;
 -- Proteger los padres antes de capturar los hijos. No desactivar FKs ni triggers.
 perform 1 from public.subject_items i join content_cleanup_subjects s on s.id=i.subject_id order by i.id for update of i;
end $$;
create temp table content_cleanup_items on commit drop as
 select i.id,i.material_id,i.exam_id from public.subject_items i join content_cleanup_subjects s on s.id=i.subject_id;
do $$begin
 perform 1 from public.course_materials m where m.id in(select material_id from content_cleanup_items) order by m.id for update;
 perform 1 from public.exams e where e.id in(select exam_id from content_cleanup_items) order by e.id for update;
 if exists(select 1 from public.subject_items i where i.exam_id in(select exam_id from content_cleanup_items)
  and not exists(select 1 from content_cleanup_items chosen where chosen.id=i.id)) then
  raise exception 'Limpieza detenida: examen compartido con una materia fuera del prefijo';end if;
end $$;
-- Defensa adicional si se permitiesen materiales compartidos en un esquema futuro.
create temp table content_cleanup_materials on commit drop as
 select m.id,m.storage_path from public.course_materials m where m.id in(select material_id from content_cleanup_items)
 and not exists(select 1 from public.subject_items i where i.material_id=m.id and not exists(select 1 from content_cleanup_items chosen where chosen.id=i.id));
create temp table content_cleanup_exams on commit drop as
 select distinct exam_id id from content_cleanup_items where exam_id is not null;
create temp table content_cleanup_attempts on commit drop as
 select a.id from public.exam_attempts a join content_cleanup_exams e on e.id=a.exam_id;
create temp table content_cleanup_deleted_materials(id uuid,storage_path text) on commit drop;

-- PRIMERO: revisar el alcance y los conteos. Los porcentajes y guiones bajos del
-- prefijo se interpretan literalmente, nunca como comodines de LIKE.
select p.prefix,s.id,s.title,s.course_id from public.course_subjects s join content_cleanup_subjects chosen on chosen.id=s.id cross join content_cleanup_params p order by s.id;
select 'materias' objeto,count(*) filas from content_cleanup_subjects union all
 select 'items',count(*) from content_cleanup_items union all
 select 'reglas',count(*) from public.item_access_rules where item_id in(select id from content_cleanup_items) union all
 select 'auditoria',count(*) from public.content_access_audit where item_id in(select id from content_cleanup_items) union all
 select 'material_progress',count(*) from public.material_progress where material_id in(select id from content_cleanup_materials) union all
 select 'attempt_answers',count(*) from public.attempt_answers where attempt_id in(select id from content_cleanup_attempts) union all
 select 'exam_attempts',count(*) from content_cleanup_attempts union all
 select 'materiales_a_borrar',count(*) from content_cleanup_materials union all
 select 'examenes_solo_desasignados',count(*) from content_cleanup_exams;

-- DESPUÉS: borrar solo las dependencias capturadas del prefijo, en este orden.
delete from public.item_access_rules where item_id in(select id from content_cleanup_items);
delete from public.content_access_audit where item_id in(select id from content_cleanup_items);
delete from public.material_progress where material_id in(select id from content_cleanup_materials);
delete from public.attempt_answers where attempt_id in(select id from content_cleanup_attempts);
delete from public.exam_attempts where id in(select id from content_cleanup_attempts);
delete from public.subject_items where id in(select id from content_cleanup_items);
with deleted as (
 delete from public.course_materials where id in(select id from content_cleanup_materials) returning id,storage_path
) insert into content_cleanup_deleted_materials select id,storage_path from deleted;
delete from public.course_subjects where id in(select id from content_cleanup_subjects);

-- No se borran exámenes, preguntas, opciones, cursos, matrículas, usuarios,
-- notificaciones ni objetos de Storage. Solo tras COMMIT, limpiar estas rutas
-- manualmente del bucket privado course-content. Tras ROLLBACK NO eliminarlas.
select id material_id,storage_path from content_cleanup_deleted_materials where storage_path is not null order by storage_path;
rollback;
