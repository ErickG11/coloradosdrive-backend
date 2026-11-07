-- MANUAL, solo lectura. Ejecutar antes de 045, después de 042–044.
begin;
do $$
declare objeto text;
begin
 foreach objeto in array array[
  'public.crear_borrador_limitado(text,uuid,text,timestamptz,jsonb)',
  'public.reservar_limite_inscripcion(text,text,text,jsonb,uuid)',
  'public.correo_tiene_cuenta(text)',
  'public.normalizar_correo_inscripcion(text)'
 ] loop
  if to_regprocedure(objeto) is null then raise exception '045 requiere objeto: %',objeto;end if;
 end loop;
 foreach objeto in array array['auth.users','public.courses','public.solicitudes_inscripcion',
  'public.correo_bloqueado','public.enrollment_rate_events','public.solicitud_auditoria'] loop
  if to_regclass(objeto) is null then raise exception '045 requiere tabla: %',objeto;end if;
 end loop;
end $$;
select 'Reemplazar correo_tiene_cuenta; crear emisión y consumo OTP solo service_role' as cambio;
select estado,count(*) from public.solicitudes_inscripcion group by estado;
rollback;
