-- SOLO LECTURA / CONTEOS; no imprime nombres, cédulas, correos ni rutas.
select count(*) as payments_presente_requiere_adaptar_026 from pg_catalog.pg_class
  where oid=to_regclass('public.payments');
select count(*) as columna_request_en_operaciones_manuales from information_schema.columns
  where table_schema='public' and table_name='manual_enrollment_operations' and column_name='request';
select count(*) as operacion_d_ya_existe from pg_catalog.pg_class where oid=to_regclass('public.student_deletion_operations');
select count(*) as alumno_activo from public.users where rol='estudiante' and activo;
select count(*) as alumno_inactivo from public.users where rol='estudiante' and not activo;
select count(*) as solicitudes_ligadas from public.solicitudes_inscripcion where student_id is not null;
select count(*) as documentos_ligados from public.solicitud_documentos d
  join public.solicitudes_inscripcion s on s.id=d.solicitud_id where s.student_id is not null;
select count(*) as solicitudes_sin_vinculo_no_se_borran from public.solicitudes_inscripcion where student_id is null;
select count(*) as referencias_a_no_estudiantes from public.solicitudes_inscripcion s
  join public.users u on u.id=s.student_id where u.rol<>'estudiante';
select count(*) as practicas_iniciadas_pasadas from public.practice_slots
  where student_id is not null and scheduled_at<=clock_timestamp();
select count(*) as practicas_futuras from public.practice_slots
  where student_id is not null and scheduled_at>clock_timestamp();
select count(*) as operaciones_manuales_ligadas from public.manual_enrollment_operations where student_id is not null;
-- Autoría inesperada: una FK RESTRICT impide el borrado; no borrar filas ajenas.
select count(*) as alumnos_autores_de_solicitudes from public.solicitudes_inscripcion s
  join public.users u on u.id=s.reviewed_by where u.rol='estudiante';
select count(*) as alumnos_autores_de_checklist from public.enrollment_documents d
  join public.users u on u.id=d.marcado_por where u.rol='estudiante';
select count(*) as alumnos_actores_de_matricula from public.manual_enrollment_operations o
  join public.users u on u.id=o.actor_id where u.rol='estudiante';
select count(*) as fks_users_no_inventariadas from pg_catalog.pg_constraint
  where contype='f' and confrelid='public.users'::regclass and conrelid not in (
    'public.enrollments'::regclass,'public.exam_attempts'::regclass,'public.practice_slots'::regclass,
    'public.solicitudes_inscripcion'::regclass,'public.enrollment_documents'::regclass,
    'public.manual_enrollment_operations'::regclass,'public.student_practice_recovery'::regclass);
