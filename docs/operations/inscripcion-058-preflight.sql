-- SOLO lectura, MANUAL antes de058.
begin;
do $$ declare f text;t text;begin
 foreach f in array array['public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)',
 'public.guard_aprobacion_intento()','public.confirmar_identidad_presencial_admin(uuid,uuid,text)',
 'public.enforce_cohort_cupo()','public.initialize_enrollment_documents()','public.enrollment_resolve_course()',
 'public.enforce_enrollment_student_role()'] loop
 if to_regprocedure(f) is null then raise exception '058 requiere objeto % (020/022/055/056/057)',f;end if;end loop;
 if position('p_estado::public.enrollment_status' in (select prosrc from pg_proc where oid='public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)'::regprocedure))=0 then
 raise exception '058 requiere la corrección057 aplicada';end if;
 foreach t in array array['enrollments_enforce_cupo','enrollments_initialize_documents','enrollments_00_resolve_course','enrollments_enforce_student_role'] loop
 if not exists(select 1 from pg_trigger where tgrelid='public.enrollments'::regclass and tgname=t and not tgisinternal) then raise exception 'Falta disparador %',t;end if;end loop;
end $$;
select 'Añadir etapa_inscripcion/reserva_expira_at, cambiar CHECK de forma y conteo de cupo; sin UPDATE de matrículas existentes' as cambio;
select tgname,pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.enrollments'::regclass and not tgisinternal;
rollback;
