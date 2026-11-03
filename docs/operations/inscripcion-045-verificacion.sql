-- MANUAL reversible. No imprime códigos/correos reales ni cambia expedientes.
begin;
do $$
declare firma text;rol text;
begin
 foreach firma in array array[
  'public.emitir_codigo_inscripcion(text,uuid,text,timestamptz,text,jsonb)',
  'public.confirmar_codigo_inscripcion(text,text,text,jsonb)',
  'public.correo_tiene_cuenta(text)'
 ] loop
  if to_regprocedure(firma) is null then raise exception 'Falta función 045: %',firma;end if;
  foreach rol in array array['anon','authenticated'] loop
   if has_function_privilege(rol,firma,'EXECUTE') then
    raise exception 'Acceso indebido de % a %',rol,firma;end if;
  end loop;
  if not has_function_privilege('service_role',firma,'EXECUTE') then
   raise exception 'Falta permiso backend en %',firma;end if;
 end loop;
end $$;
set local role authenticated;
do $$ begin
 begin
  perform public.correo_tiene_cuenta('prueba@example.invalid');
  raise exception 'authenticated ejecutó función privada';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform public.correo_tiene_cuenta('prueba@example.invalid');
  raise exception 'anon ejecutó función privada';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
