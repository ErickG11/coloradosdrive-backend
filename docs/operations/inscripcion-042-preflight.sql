-- Solo lectura. Ejecutar manualmente antes de 042; no muestra correos ni cédulas.
begin;
set local statement_timeout = '15s';
do $$
declare t text;
begin
  foreach t in array array['solicitudes_inscripcion','solicitud_documentos',
    'solicitud_consentimientos','solicitud_auditoria','enrollment_documents','courses','enrollments','users'] loop
    if to_regclass('public.' || t) is null then raise exception 'Falta tabla requerida: %',t; end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || t)) then
      raise exception 'RLS debe estar activo en %',t;
    end if;
  end loop;
  if to_regprocedure('public.revisar_documento_solicitud(uuid,uuid,uuid,text,text)') is null
    or to_regprocedure('public.enviar_solicitud(uuid,text)') is null
    or not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='solicitudes_inscripcion' and column_name='enviada_at') then
    raise exception 'Aplicar 040 y 041 antes de 042';
  end if;
  if exists(select 1 from public.solicitudes_inscripcion
    where estado not in ('pendiente_revision','borrador','enviada','devuelta','aprobada','rechazada')) then
    raise exception 'Existen estados no reconocidos';
  end if;
  if exists(
    select 1 from public.solicitudes_inscripcion
    group by case when split_part(lower(btrim(correo)),'@',2) in ('gmail.com','googlemail.com')
      then replace(split_part(split_part(lower(btrim(correo)),'@',1),'+',1),'.','') || '@gmail.com'
      else lower(btrim(correo)) end
    having count(*) > 1
  ) then raise exception 'Correos equivalentes: reconciliar expedientes antes de 042; no se fusionan automáticamente'; end if;
  if exists(select 1 from public.solicitudes_inscripcion where reviewed_at is not null
    and estado='pendiente_revision') then
    raise exception 'Hay decisiones/eliminaciones en curso: detener backend, reconciliar claims y reintentar';
  end if;
end $$;
-- Solo IDs técnicos para reconciliación manual; no inferir nombres ni estudios legacy.
select id,estado,enviada_at is not null as enviada
  from public.solicitudes_inscripcion where estado in ('aprobada','rechazada') and enviada_at is null;
select tipo_documento,count(*) as filas_legacy from public.solicitud_documentos
  where tipo_documento <> 'certificado_estudios' group by tipo_documento;
rollback;
