begin read only;
select to_regclass('public.solicitudes_inscripcion') solicitudes,
 to_regclass('public.solicitud_documentos') documentos,
 to_regclass('public.enrollment_documents') checklist,
 to_regclass('public.practice_ratings') calificaciones;
select table_name, column_name from information_schema.columns
where table_schema='public' and table_name in ('solicitudes_inscripcion','solicitud_documentos','enrollments');
select id, public from storage.buckets where id='solicitudes-documentos';
-- Revisar requisitos 001–036 y bucket privado antes de aplicar.
rollback;
