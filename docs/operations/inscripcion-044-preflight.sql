-- Solo lectura. Requiere 043 y backend detenido para despliegue conjunto.
begin;
do $$ begin
  if to_regprocedure('public.consumir_cupo_inscripcion(text,integer)') is null
    or to_regclass('public.app_settings') is null or to_regclass('public.enrollment_rate_events') is null
    or to_regclass('public.inscripcion_endurecimiento_respaldo') is null then
    raise exception '044 requiere 042 y 043 completas';
  end if;
end $$;
select tipo,count(*) from public.enrollment_rate_events group by tipo;
select id,inscripciones_abiertas,updated_at from public.app_settings;
rollback;
