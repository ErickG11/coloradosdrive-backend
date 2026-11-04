begin;
do $$ begin
 if to_regprocedure('public.confirmar_identidad_presencial(uuid,uuid,boolean)') is null
 or to_regprocedure('public.reclamar_aprobacion_inscripcion(uuid,uuid,uuid,uuid,text,text)') is null
 or to_regprocedure('public.correo_tiene_cuenta(text)') is null then raise exception 'Falta052/054 o helper de cuenta';end if;
end $$;
select 'Crear ledger técnico privado e invalidar finalización si la recuperación tomó el intento' as cambio;
select count(*) as reclamos_legacy from public.solicitudes_inscripcion where estado='enviada' and reviewed_at is not null;
rollback;
