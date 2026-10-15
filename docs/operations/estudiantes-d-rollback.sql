-- Reversión MANUAL de 026, con aprobación. No restaura datos ni archivos/Auth.
-- Retirar endpoints D y pausar peticiones antes de ejecutar; no desbloquear
-- alumnos con eliminación iniciada. Mantener middleware B y bans existentes.
-- Conservar student_deletion_operations (incluidas completas) y ACL/RLS.
-- No reejecutar 026: la tabla se conserva deliberadamente.
begin;
set local lock_timeout='5s';
-- No retirar guards con un borrado parcial todavía reanudable.
do $$ begin
  if to_regclass('public.student_deletion_operations') is not null then
    if exists(select 1 from public.student_deletion_operations where status<>'completo') then
      raise exception 'Hay eliminaciones pendientes; completar o revisar antes del rollback' using errcode='55000';
    end if;
  end if;
end $$;
drop trigger if exists users_deletion_profile_guard on public.users;
drop trigger if exists users_deletion_reactivation_guard on public.users;
drop trigger if exists enrollments_deletion_guard on public.enrollments;
drop trigger if exists solicitudes_deletion_approval_guard on public.solicitudes_inscripcion;
drop function if exists private.guard_student_deletion_write();
drop function if exists private.assert_student_not_deleting(uuid);
drop function if exists public.begin_student_deletion(uuid,uuid,text);
drop function if exists public.advance_student_deletion(uuid,uuid,text,timestamptz,text);
drop function if exists public.student_deletion_storage_paths(uuid,uuid);
drop function if exists public.delete_student_data(uuid,uuid,timestamptz,text[]);
notify pgrst,'reload schema';
commit;
