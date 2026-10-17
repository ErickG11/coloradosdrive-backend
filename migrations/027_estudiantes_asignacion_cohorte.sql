-- C: revisar SQL y respaldo antes de aplicar. Sin cambios de datos existentes.
begin;
set local lock_timeout='5s';

alter table public.enrollments
  add column cohort_assigned_by uuid,
  add column cohort_assigned_at timestamptz,
  add constraint enrollments_cohort_assignment_audit_pair
    check ((cohort_assigned_by is null)=(cohort_assigned_at is null));
comment on column public.enrollments.cohort_assigned_by is
  'Admin que confirmó C; UUID sin FK ni datos personales. Se elimina con la matrícula en D.';
comment on column public.enrollments.cohort_assigned_at is
  'Fecha de asignación tardía confirmada; no reemplaza fecha_inscripcion.';

-- La ventana vive exclusivamente en isCohortWindowOpen (TypeScript).
-- Estos argumentos son internos: backend valida ventana y conserva updated_at exacto.
create function public.assign_pending_enrollment_cohort(
  p_actor uuid, p_student uuid, p_enrollment uuid, p_cohort uuid,
  p_cohort_version timestamptz, p_validated_day date
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.enrollments; c public.cohorts; v_active boolean; v_net numeric;
begin
  if not exists(select 1 from public.users where id=p_actor and rol='admin') then
    raise exception 'Se requiere administrador' using errcode='42501'; end if;
  if p_actor is null or p_student is null or p_enrollment is null or p_cohort is null then
    raise exception 'Asignación inválida' using errcode='22023'; end if;

  -- Mismo orden que B/D: alumno antes de matrícula; cohorte al final.
  select activo into v_active from public.users
    where id=p_student and rol='estudiante' for share;
  if not found then raise exception 'Alumno no encontrado' using errcode='CD404'; end if;
  perform private.assert_student_not_deleting(p_student);
  if not v_active then raise exception 'Cuenta inactiva' using errcode='CD403'; end if;
  select * into e from public.enrollments
    where id=p_enrollment and student_id=p_student for update;
  if not found then raise exception 'Matrícula no encontrada' using errcode='CD040'; end if;
  if e.status='activo' and e.cohort_id=p_cohort then return to_jsonb(e); end if;
  if e.status<>'pendiente_cohorte' then
    raise exception 'La matrícula ya no está pendiente de cohorte' using errcode='CD041'; end if;

  select * into c from public.cohorts where id=p_cohort for update;
  if not found then raise exception 'Cohorte no encontrada' using errcode='CD042'; end if;
  if c.course_id<>e.course_id then
    raise exception 'La cohorte no corresponde al curso' using errcode='CD043'; end if;
  if p_cohort_version is null or p_validated_day is null then
    raise exception 'Falta validación de ventana' using errcode='22023'; end if;
  -- Reloj leído DESPUÉS de esperar todos los locks. No repetir el predicado de ventana.
  if c.updated_at is distinct from p_cohort_version or
    (clock_timestamp() at time zone 'America/Guayaquil')::date is distinct from p_validated_day then
    raise exception 'La cohorte o el día cambiaron; recarga antes de confirmar' using errcode='CD044'; end if;
  v_net:=c.precio-e.descuento;
  if v_net<0 or e.monto_abonado>v_net then
    raise exception 'El abono supera el neto de la cohorte' using errcode='CD045'; end if;
  -- El trigger enforce_cohort_cupo revalida cupo bajo este mismo lock (CD001).
  update public.enrollments set cohort_id=p_cohort,status='activo',monto_total=v_net,
    cohort_assigned_by=p_actor,cohort_assigned_at=clock_timestamp()
    where id=e.id returning * into e;
  return to_jsonb(e);
end $$;

revoke all on function public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date)
  from public,anon,authenticated;
grant execute on function public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date)
  to service_role;
notify pgrst, 'reload schema';
commit;
