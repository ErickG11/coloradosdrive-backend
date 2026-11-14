begin read only;
-- Exportar números sin forma de cédula y expedientes sin documento. No inferir pasaportes desde nacionalidad.
select jsonb_build_object('entity','user','id',id,'evidence','legacy_cedula','shapeValid',cedula~'^[0-9]{10}$') as candidate from public.users where cedula is null or cedula!~'^[0-9]{10}$';
select jsonb_build_object('entity','request','id',id,'state',estado,'evidence','documento pendiente') as candidate from public.solicitudes_inscripcion where cedula is null;
select key,implemented,enabled from public.enrollment_rule_flags order by key;
rollback;
