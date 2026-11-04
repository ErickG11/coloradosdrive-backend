-- MANUAL: revertir el backend antes. Las verificaciones ya registradas se conservan.
begin;
drop function if exists public.registrar_verificacion_inscripcion(uuid,uuid,text,text,text,text,boolean);
drop function if exists public.listar_solicitudes_admin(text,text,integer,integer);
-- Restaura la guarda de 042 (sin la excepción de archivo_verificado_at).
create or replace function public.guard_solicitud_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare s public.solicitudes_inscripcion;
begin
  select * into s from public.solicitudes_inscripcion where id = new.solicitud_id for update;
  if not found then raise exception 'Solicitud inexistente' using errcode = 'SI404'; end if;
  if tg_table_name = 'solicitud_documentos' then
    if new.tipo_documento <> 'certificado_estudios' or
      (tg_op = 'UPDATE' and old.tipo_documento <> 'certificado_estudios') then
      raise exception 'Documento legacy de solo lectura' using errcode = 'SI410';
    end if;
    if tg_op = 'UPDATE' and old.storage_path is not null and new.storage_path is null
      and new.archivo_eliminado_at is not null
      and (to_jsonb(new) - 'storage_path' - 'archivo_eliminado_at') =
          (to_jsonb(old) - 'storage_path' - 'archivo_eliminado_at') then return new; end if;
  end if;
  if s.estado not in ('borrador','devuelta') then
    raise exception 'La solicitud no admite cambios en este estado' using errcode = 'SI409';
  end if;
  return new;
end $$;
revoke all on function public.guard_solicitud_edit() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
