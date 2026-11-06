begin;
do $$ begin
 if to_regclass('public.solicitud_aprobacion_intentos') is null
 or to_regprocedure('public.confirmar_identidad_presencial(uuid,uuid,boolean)') is null
 or not exists(select 1 from information_schema.columns where table_schema='public'
 and table_name='enrollments' and column_name='identidad_presencial_por') then
 raise exception 'Falta055/054/042';end if;
end $$;
select 'Crear auditoría append-only privada y RPC de override admin, sin alterar054 ni certificado original' as cambio;
select count(*) as pendientes from public.enrollments where origen='solicitud' and identidad_presencial_at is null;
rollback;
