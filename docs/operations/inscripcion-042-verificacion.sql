-- Ejecutar manualmente después de 042. Todas las escrituras se revierten.
begin;
set local statement_timeout = '15s';
lock table public.enrollment_counters in access exclusive mode;
do $$
declare t text; v integer; v_antes integer; v_dia date;
begin
  foreach t in array array['solicitud_verificaciones','correo_bloqueado','app_settings',
    'enrollment_counters','enrollment_rate_events'] loop
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.' || t)) then
      raise exception 'RLS ausente: %',t;
    end if;
    if exists(select 1 from pg_policies where schemaname='public' and tablename=t) then
      raise exception 'La tabla privada no debe tener políticas: %',t;
    end if;
    if has_table_privilege('anon','public.' || t,'SELECT')
      or has_table_privilege('authenticated','public.' || t,'INSERT') then
      raise exception 'Privilegios públicos inesperados: %',t;
    end if;
  end loop;
  if (select count(*) from public.app_settings) <> 1 then raise exception 'Configuración no singleton'; end if;
  if exists(select 1 from public.solicitudes_inscripcion where estado='pendiente_revision') then
    raise exception 'Backfill de estados incompleto';
  end if;
  if public.normalizar_correo_inscripcion(' A.B+prueba@googlemail.com ') <> 'ab@gmail.com'
    or public.normalizar_correo_inscripcion(' A.B+prueba@example.invalid ') <> 'a.b+prueba@example.invalid' then
    raise exception 'Normalización de comparación incorrecta';
  end if;
  v_dia := (clock_timestamp() at time zone 'America/Guayaquil')::date;
  select coalesce((select usado from public.enrollment_counters where dia=v_dia and tipo='codigos'),0) into v_antes;
  select public.consumir_cupo_inscripcion('codigos',v_antes+1) into v;
  if v is distinct from v_antes+1 then raise exception 'Incremento de contador incorrecto'; end if;
  if public.consumir_cupo_inscripcion('codigos',v_antes+1) is not null then raise exception 'Sobrepasó el tope'; end if;
  if public.consumir_cupo_inscripcion('subidas',0) is not null then raise exception 'Tope cero no respetado'; end if;
  if has_function_privilege('authenticated','public.consumir_cupo_inscripcion(text,integer)','EXECUTE') then
    raise exception 'Contador accesible sin backend';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='solicitudes_admin' and column_name='documentos_por_revisar') then
    raise exception 'Vista todavía expone el contrato documental anterior';
  end if;
end $$;
select public.resumen_solicitudes();
rollback;
