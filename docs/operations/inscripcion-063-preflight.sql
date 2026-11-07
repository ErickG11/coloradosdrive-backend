-- Solo lectura. Exige los cuerpos conocidos, normalizados para CRLF.
begin;
do $$ begin
 if to_regprocedure('public.guardar_datos_inscripcion(uuid,jsonb,text,text)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.guardar_datos_inscripcion(uuid,jsonb,text,text)')) not in ('ac6eecd5a84d669ca9310fba12608a38','c23429eae2e4f50488d43fc74046485e') then raise exception '063: falta función o cuerpo distinto: public.guardar_datos_inscripcion(uuid,jsonb,text,text)';end if;
 if to_regprocedure('public.enviar_solicitud_inscripcion(uuid,text,text,text)') is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.enviar_solicitud_inscripcion(uuid,text,text,text)')) not in ('3dce5e58fee6f052276ac709ca31d53e','cc6d506c0eb22af1d579e37369026618') then raise exception '063: falta función o cuerpo distinto: public.enviar_solicitud_inscripcion(uuid,text,text,text)';end if;
end $$;
select 'Teléfono local obligatorio en guardado/envío; retirar cursando_bachillerato de entradas nuevas' as cambio;
rollback;
