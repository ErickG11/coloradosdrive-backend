-- MANUAL: revertir backend primero. Nunca eliminar evidencia para recuperar una UNIQUE.
begin;
set local lock_timeout='5s';
lock table public.solicitud_consentimientos in access exclusive mode;
do $$ begin
 if exists(select 1 from public.solicitud_consentimientos group by solicitud_id,version_aviso having count(*)>1) then
  raise exception 'Rollback detenido sin cambios: hay varias versiones de términos para un aviso; conservar evidencia y usar backend046';end if;
end $$;
drop function if exists public.aceptar_consentimiento_inscripcion(uuid,text,text,boolean);
alter table public.solicitud_consentimientos drop constraint if exists solicitud_consentimientos_versiones_key;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.solicitud_consentimientos'::regclass
  and conname='solicitud_consentimientos_solicitud_id_version_aviso_key') then
  alter table public.solicitud_consentimientos add constraint solicitud_consentimientos_solicitud_id_version_aviso_key
   unique(solicitud_id,version_aviso);
 end if;
end $$;
-- Se conserva la columna aditiva y su evidencia de autorización.
notify pgrst,'reload schema';
commit;
