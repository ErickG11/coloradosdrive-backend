-- MANUAL, sin escrituras ni datos personales.
begin;
do $$ begin
 if to_regprocedure('public.registrar_verificacion_inscripcion(uuid,uuid,text,text,text,text,boolean)') is null
  or to_regclass('public.correo_bloqueado') is null
  or to_regclass('public.solicitud_consentimientos') is null then raise exception '051 requiere 042–050 completas';end if;
 if not has_table_privilege('service_role','public.correo_bloqueado','INSERT')
  or not has_table_privilege('service_role','public.correo_bloqueado','UPDATE') then
  raise exception 'service_role sin permisos sobre correo_bloqueado';end if;
 if (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name='solicitudes_inscripcion'
   and c.column_name in ('devuelta_por','devolucion_nota_interna','rechazo_nota_interna','rechazo_motivo_codigo'))<4 then
  raise exception 'Faltan columnas de decisión (042)';end if;
end $$;
select 'Crear devolver_solicitud_inscripcion, rechazar_solicitud_inscripcion y validar_aprobacion_inscripcion' as cambio;
select estado,count(*) from public.solicitudes_inscripcion group by estado order by estado;
rollback;
