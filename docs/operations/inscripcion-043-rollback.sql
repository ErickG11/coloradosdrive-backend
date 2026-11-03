-- Revertir manualmente DESPUÉS de revertir migraciones posteriores. No eliminar filas de negocio.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $rollback$
declare sentencia text; restore text[];
begin
  if current_user<>'postgres' then raise exception 'Rollback 043 requiere postgres'; end if;
  if to_regclass('public.inscripcion_endurecimiento_respaldo') is null then return; end if;
  select restauracion into restore from public.inscripcion_endurecimiento_respaldo where id;
  if restore is null then raise exception 'Falta respaldo completo: no se inventarán permisos previos'; end if;
  foreach sentencia in array restore loop execute sentencia; end loop;
  drop table public.inscripcion_endurecimiento_respaldo;
end $rollback$;
notify pgrst,'reload schema';
commit;
