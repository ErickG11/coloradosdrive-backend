-- Manual: revertir backend primero. Conservar eventos/auditoría y no recuperar OTP consumidos.
begin;
drop function if exists public.emitir_codigo_inscripcion(text,uuid,text,timestamptz,text,jsonb);
drop function if exists public.confirmar_codigo_inscripcion(text,text,text,jsonb);
create or replace function public.correo_tiene_cuenta(p_correo text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where lower(email)=lower(trim(p_correo)))
$$;
revoke all on function public.correo_tiene_cuenta(text) from public,anon,authenticated;
grant execute on function public.correo_tiene_cuenta(text) to service_role;
notify pgrst,'reload schema';
commit;
