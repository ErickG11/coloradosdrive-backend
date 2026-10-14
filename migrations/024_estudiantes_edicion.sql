-- Propuesta A2: pendiente de aprobación; no aplicar al proyecto real.
begin;
set local lock_timeout = '5s';

create table public.student_profile_audit (
  operation_id uuid primary key,
  actor_id uuid not null,
  student_id uuid not null,
  changed_fields text[] not null,
  created_at timestamptz not null default now(),
  constraint student_profile_audit_fields check (
    cardinality(changed_fields) > 0 and
    changed_fields <@ array['cedula','nombre_completo','telefono','fecha_nacimiento',
      'tipo_sangre','genero','ciudadania','direccion','correo']::text[]
  )
);
-- Sin FK: conservar identificadores de auditoría después de borrar usuarios.
comment on table public.student_profile_audit is
  'Cambios confirmados: identificadores, fecha y campos; sin valores personales.';
alter table public.student_profile_audit enable row level security;
revoke all on public.student_profile_audit from public, anon, authenticated, service_role;
grant select, insert on public.student_profile_audit to service_role;
create index student_profile_audit_student_date_idx
  on public.student_profile_audit(student_id, created_at desc, operation_id);

create function public.save_student_profile(
  p_actor uuid, p_student uuid, p_operation uuid, p_base_version timestamptz,
  p_profile jsonb, p_email_changed boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_before public.users%rowtype;
  v_after public.users%rowtype;
  v_fields text[];
begin
  if not exists(select 1 from public.users where id = p_actor and rol = 'admin') then
    raise exception 'Se requiere administrador' using errcode = '42501';
  end if;
  if p_operation is null or p_base_version is null or p_email_changed is null or
     p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Perfil inválido' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_each(p_profile) as item(key,value)
    where key not in ('cedula','nombre_completo','telefono','fecha_nacimiento',
      'tipo_sangre','genero','ciudadania','direccion') or
      jsonb_typeof(value) not in ('string','null')) or
    (p_profile ? 'cedula' and coalesce(p_profile->>'cedula','') !~ '^[0-9]{10}$') or
    (p_profile ? 'nombre_completo' and
      (length(btrim(coalesce(p_profile->>'nombre_completo',''))) not between 1 and 200)) then
    raise exception 'Perfil inválido' using errcode = '22023';
  end if;
  select * into v_before from public.users
    where id = p_student and rol = 'estudiante' for update;
  if not found then
    raise exception 'Alumno no encontrado' using errcode = 'CD404';
  end if;
  if v_before.updated_at <> p_base_version then
    raise exception 'Versión obsoleta' using errcode = 'CD409';
  end if;
  select coalesce(array_agg(key order by key), array[]::text[]) into v_fields
    from jsonb_each(p_profile) as item(key,value)
    where value is distinct from to_jsonb(v_before)->key;
  if p_email_changed then v_fields := array_append(v_fields, 'correo'); end if;
  if cardinality(v_fields) = 0 then
    return jsonb_build_object('operationId', p_operation, 'updatedAt', v_before.updated_at,
      'changedFields', v_fields);
  end if;
  -- Un solo UPDATE; el trigger existente conserva microsegundos en updated_at.
  update public.users set
    cedula = case when p_profile ? 'cedula' then p_profile->>'cedula' else cedula end,
    nombre_completo = case when p_profile ? 'nombre_completo' then p_profile->>'nombre_completo' else nombre_completo end,
    telefono = case when p_profile ? 'telefono' then p_profile->>'telefono' else telefono end,
    fecha_nacimiento = case when p_profile ? 'fecha_nacimiento' then (p_profile->>'fecha_nacimiento')::date else fecha_nacimiento end,
    tipo_sangre = case when p_profile ? 'tipo_sangre' then p_profile->>'tipo_sangre' else tipo_sangre end,
    genero = case when p_profile ? 'genero' then p_profile->>'genero' else genero end,
    ciudadania = case when p_profile ? 'ciudadania' then p_profile->>'ciudadania' else ciudadania end,
    direccion = case when p_profile ? 'direccion' then p_profile->>'direccion' else direccion end
  where id = p_student and rol = 'estudiante' and updated_at = p_base_version
  returning * into v_after;
  if not found then
    raise exception 'Versión obsoleta' using errcode = 'CD409';
  end if;
  insert into public.student_profile_audit(operation_id, actor_id, student_id, changed_fields)
    values(p_operation, p_actor, p_student, v_fields);
  return jsonb_build_object('operationId', p_operation, 'updatedAt', v_after.updated_at,
    'changedFields', v_fields);
end;
$$;

revoke all on function public.save_student_profile(uuid,uuid,uuid,timestamptz,jsonb,boolean)
  from public, anon, authenticated;
grant execute on function public.save_student_profile(uuid,uuid,uuid,timestamptz,jsonb,boolean)
  to service_role;
notify pgrst, 'reload schema';
commit;
