-- Solo lectura. Ejecutar ANTES de059.
begin;
do $$ declare f text;begin
 foreach f in array array['public.cohort_cupo_ocupado(uuid,uuid)','public.practice_free_instructors(timestamp with time zone[],uuid)',
 'private.assert_student_not_deleting(uuid)','public.set_student_active(uuid,uuid,boolean)','public.delete_student_data(uuid,uuid,timestamptz,text[])'] loop
 if to_regprocedure(f) is null then raise exception '059 requiere058 completa; falta %',f;end if;end loop;
 if not exists(select 1 from pg_attribute where attrelid='public.enrollments'::regclass and attname='etapa_inscripcion' and not attisdropped)
 or to_regclass('public.notifications') is null then raise exception '059 requiere etapas y notificaciones';end if;
 if not exists(select 1 from pg_extension where extname='btree_gist') then raise exception '059 requiere btree_gist existente';end if;
end $$;
select 'Crear reservas, leases de franjas y contador diario; ampliar sugerencia manual; guardas de escritura/desactivación/cohorte' as cambio;
select tgname,pg_get_triggerdef(oid) from pg_trigger where tgrelid in ('public.practice_slots'::regclass,'public.users'::regclass,'public.cohorts'::regclass) and not tgisinternal;
rollback;
