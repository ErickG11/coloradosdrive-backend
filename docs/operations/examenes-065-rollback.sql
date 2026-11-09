-- Rollback sin pérdida: RECHAZA uso real del módulo. Retirar 066 primero.
-- Si hay contenido/progreso/reglas/auditoría u objetos de Storage, conservar datos y corregir hacia adelante.
begin;
set local lock_timeout='5s';
do $$begin
 if to_regprocedure('public.content_admin(uuid,text,jsonb)') is not null then raise exception 'Revertir066 primero';end if;
 if exists(select 1 from public.course_materials) or exists(select 1 from public.material_progress) or exists(select 1 from public.item_access_rules) or exists(select 1 from public.content_access_audit) or exists(select 1 from private.content_upload_limits)
 or exists(select 1 from public.course_subjects where title<>'Exámenes anteriores (sin clasificar)' or is_published or description is not null or order_index<>0)
 or exists(select 1 from public.subject_items i join public.course_subjects s on s.id=i.subject_id where i.kind<>'examen' or s.title<>'Exámenes anteriores (sin clasificar)')
 or exists(select 1 from storage.objects where bucket_id='course-content')
 or exists(select 1 from public.notifications where tipo in ('contenido_habilitado','examen_habilitado','intento_extra'))
 or exists(select 1 from public.exams where shuffle_questions or shuffle_options or description is not null or max_attempts_default is distinct from case when type='definitivo' then 1 else null end)
 then raise exception 'Rollback065 bloqueado: módulo usado; no destruir datos';end if;
end $$;
drop trigger content_published_question_guard on public.questions;
drop trigger content_published_option_guard on public.question_options;
drop function private.content_published_exam_guard();
drop trigger content_attempt_immutable on public.exam_attempts;
drop trigger content_option_guard on public.question_options;
drop trigger content_question_guard on public.questions;
drop trigger content_exam_guard on public.exams;
drop trigger item_access_rules_consistency on public.item_access_rules;
drop trigger subject_items_consistency on public.subject_items;
drop function private.content_attempt_immutable();
drop function private.content_exam_guard();
drop function private.content_consistency();
drop function private.student_course_progress(uuid,uuid);
drop function private.start_exam_attempt(uuid,uuid);
drop function private.finalize_expired_content_attempts(uuid,uuid);
drop function private.resolve_item_access(uuid,uuid);
drop function private.content_student_eligible(uuid,uuid);
drop table public.content_access_audit;
drop table public.material_progress;
drop table public.item_access_rules;
drop table public.subject_items;
drop table public.course_materials;
drop table public.course_subjects;
drop table private.content_upload_limits;
alter table public.exam_attempts drop constraint exam_attempts_number;
drop index public.exam_attempts_one_in_progress;
alter table public.exam_attempts drop column attempt_number,drop column deadline_at,drop column max_attempts_aplicado,drop column minutos_aplicados;
alter table public.exams drop column max_attempts_default,drop column shuffle_questions,drop column shuffle_options,drop column description;
alter table public.notifications drop constraint notifications_tipo_check;
alter table public.notifications add constraint notifications_tipo_check check(tipo in ('recordatorio_practica','resultado_cancelacion','cupo_disponible','sin_practica_instructor','cambio_realizado','asistencia_corregida','encuesta_practica','documento_aprobado','documento_rechazado'));
delete from storage.buckets where id='course-content';
drop policy course_content_backend_only on storage.objects;
create or replace function public.enforce_attempt_student_role()
returns trigger
language plpgsql
as $$
declare
  student_role user_role;
begin
  select rol into student_role from users where id = new.student_id;

  if student_role is distinct from 'estudiante' then
    raise exception 'exam_attempts.student_id (%) must reference a user with rol = estudiante', new.student_id;
  end if;

  return new;
end;
$$;
create or replace function public.enforce_option_question_type()
returns trigger
language plpgsql
as $$
declare
  q_type question_type;
begin
  select type into q_type from questions where id = new.question_id;

  if q_type is distinct from 'opcion_multiple' then
    raise exception 'question_options.question_id (%) must reference a question with type = opcion_multiple', new.question_id;
  end if;

  return new;
end;
$$;
notify pgrst,'reload schema';
commit;
