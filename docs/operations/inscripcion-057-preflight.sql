-- SOLO lectura; ejecutar manualmente antes de057.
begin;
do $$ begin
 if to_regprocedure('public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)') is null
 or to_regprocedure('public.guard_aprobacion_intento()') is null then
 raise exception '057 requiere052 y055 completas';end if;
 if (select md5(prosrc) from pg_proc where oid='public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)'::regprocedure) not in ('26561c80450d360b8f72e922b1b43b16','eb7ce49216753f407932801a313a7514') then
 raise exception 'Cuerpo de aprobación distinto del revisado: no se modifica; comparar cambios manuales';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.enrollments'::regclass
 and attname='status' and atttypid='public.enrollment_status'::regtype and not attisdropped) then
 raise exception 'enrollments.status no tiene el tipo esperado';end if;
 if not exists(select 1 from pg_enum where enumtypid='public.enrollment_status'::regtype and enumlabel='activo')
 or not exists(select 1 from pg_enum where enumtypid='public.enrollment_status'::regtype and enumlabel='pendiente_cohorte') then
 raise exception 'Faltan estados de matrícula';end if;
end $$;
select 'Convertir p_estado explícitamente a public.enrollment_status al finalizar aprobación; sin modificar filas ni055' as cambio;
select n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid='public.finalizar_aprobacion_inscripcion(uuid,uuid,timestamptz,uuid,uuid,text,numeric)'::regprocedure;
rollback;
