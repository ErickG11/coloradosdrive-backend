-- F44-d. MANUAL después de055. Override auditado de la matrícula más reciente.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regclass('public.solicitud_aprobacion_intentos') is null
 or to_regprocedure('public.confirmar_identidad_presencial(uuid,uuid,boolean)') is null then
 raise exception '056 requiere055 y054 completas';end if;
end $$;
-- Evidencia append-only, sin FK: sobrevive a la eliminación reglada del expediente.
create table if not exists public.identidad_presencial_overrides(
 id uuid primary key default gen_random_uuid(),student_id uuid not null,
 enrollment_id uuid not null unique,actor_id uuid not null,slot_id uuid not null,
 motivo text not null check(char_length(btrim(motivo)) between 10 and 300),
 creado_at timestamptz not null default clock_timestamp());
alter table public.identidad_presencial_overrides enable row level security;
revoke all on public.identidad_presencial_overrides from public,anon,authenticated,service_role;
grant select,insert on public.identidad_presencial_overrides to service_role;
create or replace function public.guard_identidad_override_audit() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 raise exception 'La auditoría de identidad es append-only' using errcode='IP409';
end $$;
drop trigger if exists identidad_override_append_only on public.identidad_presencial_overrides;
create trigger identidad_override_append_only before update or delete on public.identidad_presencial_overrides
 for each row execute function public.guard_identidad_override_audit();
revoke all on function public.guard_identidad_override_audit() from public,anon,authenticated;
grant execute on function public.guard_identidad_override_audit() to service_role;

create or replace function public.confirmar_identidad_presencial_admin(p_student uuid,p_actor uuid,p_motivo text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.enrollments;v_slot uuid;v_sol uuid;v_now timestamptz;
begin
 if p_motivo is null or char_length(btrim(p_motivo)) not between 10 and 300
 or p_motivo ~ '[[:cntrl:]]' then
 raise exception 'Motivo inválido' using errcode='IP422';end if;
 perform 1 from public.users where id=p_actor and rol='admin' and activo for share;
 if not found then raise exception 'Se requiere administrador activo' using errcode='IP403';end if;
 -- Serializa también inserciones de matrícula (FK al alumno).
 perform 1 from public.users where id=p_student and rol='estudiante' for update;
 if not found then raise exception 'Alumno no encontrado' using errcode='IP404';end if;
 select * into e from public.enrollments where student_id=p_student
 order by fecha_inscripcion desc,id limit 1 for update;
 if not found or e.origen<>'solicitud' then
 raise exception 'El alumno no proviene de solicitud' using errcode='IP412';end if;
 if e.identidad_presencial_at is not null then
 return jsonb_build_object('transicion',false,'confirmadaAt',e.identidad_presencial_at,
  'confirmadaPor',e.identidad_presencial_por,'enrollmentId',e.id);end if;
 v_now:=clock_timestamp();
 -- Al menos una franja propia de esta cohorte cuyo plazo del instructor ya venció.
 select id into v_slot from public.practice_slots where student_id=p_student
 and cohort_id=e.cohort_id and status in ('confirmado','completado')
 and scheduled_at+make_interval(mins=>duration_minutes)+interval '48 hours'<v_now
 order by scheduled_at,id limit 1;
 if not found then raise exception 'No ha vencido la ventana del instructor' using errcode='IP410';end if;
 update public.enrollments set identidad_presencial_at=v_now,identidad_presencial_por=p_actor where id=e.id;
 -- Este endpoint confirma identidad; NO certifica haber visto el certificado original.
 insert into public.identidad_presencial_overrides(student_id,enrollment_id,actor_id,slot_id,motivo,creado_at)
 values(p_student,e.id,p_actor,v_slot,btrim(p_motivo),v_now);
 select id into v_sol from public.solicitudes_inscripcion where student_id=p_student and estado='aprobada'
 order by solicitada_at desc,id limit 1;
 if v_sol is not null then insert into public.solicitud_auditoria(solicitud_id,actor_id,accion)
 values(v_sol,p_actor,'identidad_presencial_override_admin');end if;
 return jsonb_build_object('transicion',true,'confirmadaAt',v_now,'confirmadaPor',p_actor,'enrollmentId',e.id);
end $$;
revoke all on function public.confirmar_identidad_presencial_admin(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirmar_identidad_presencial_admin(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
