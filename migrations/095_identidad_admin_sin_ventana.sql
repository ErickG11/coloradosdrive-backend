-- 095. MANUAL, después de 056 (y 094). ADR 027. CD-364: el instructor ya no confirma la cédula original
-- (ADR 026); la verificación de identidad queda solo a cargo del administrador y puede hacerse en cualquier
-- momento. Se elimina la espera de 48 horas tras una práctica y el motivo pasa a ser opcional.
-- No cambia el nombre ni los tipos de los parámetros; solo p_motivo gana el valor por defecto null, de modo que
-- el backend anterior (que siempre envía motivo) sigue funcionando.
--
-- REVERSA (documentada; no automática):
--   1. Restaurar la función con el cuerpo de la migración 056 (confirmar_identidad_presencial_admin con la
--      comprobación IP410 y el motivo obligatorio): ejecutar de nuevo el CREATE OR REPLACE FUNCTION de 056.
--      Si hay parámetro por defecto, quitarlo exige primero:
--        drop function public.confirmar_identidad_presencial_admin(uuid,uuid,text);
--      y después ejecutar el bloque de 056 con sus revoke/grant.
--   2. Las columnas slot_id y motivo de public.identidad_presencial_overrides pueden quedar nulables: es
--      inofensivo. Restaurar NOT NULL solo es posible si ninguna fila las tiene nulas:
--        select count(*) from public.identidad_presencial_overrides where slot_id is null or motivo is null;
--      Esas filas son evidencia append-only y no se borran.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.confirmar_identidad_presencial_admin(uuid,uuid,text)') is null
  or to_regclass('public.identidad_presencial_overrides') is null then
  raise exception '095 requiere la migración 056 completa';end if;
end $$;

-- Sin ventana del instructor ya no hay franja que registrar, y el motivo deja de ser obligatorio.
alter table public.identidad_presencial_overrides alter column slot_id drop not null;
alter table public.identidad_presencial_overrides alter column motivo drop not null;
alter table public.identidad_presencial_overrides
 drop constraint if exists identidad_presencial_overrides_motivo_check;
alter table public.identidad_presencial_overrides
 add constraint identidad_presencial_overrides_motivo_check
 check(motivo is null or char_length(btrim(motivo)) between 10 and 300);

create or replace function public.confirmar_identidad_presencial_admin(
 p_student uuid,p_actor uuid,p_motivo text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare e public.enrollments;v_sol uuid;v_now timestamptz;v_motivo text;
begin
 v_motivo:=nullif(btrim(coalesce(p_motivo,'')),'');
 if v_motivo is not null and (char_length(v_motivo) not between 10 and 300
  or v_motivo ~ '[[:cntrl:]]') then
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
 -- Idempotente: repetir no escribe nada y conserva la primera confirmación.
 if e.identidad_presencial_at is not null then
  return jsonb_build_object('transicion',false,'confirmadaAt',e.identidad_presencial_at,
   'confirmadaPor',e.identidad_presencial_por,'enrollmentId',e.id);end if;
 v_now:=clock_timestamp();
 update public.enrollments set identidad_presencial_at=v_now,identidad_presencial_por=p_actor
  where id=e.id;
 -- Evidencia append-only: quién, cuándo, matrícula y alumno. La unicidad por matrícula evita duplicados.
 -- Este endpoint confirma identidad; NO certifica haber visto el certificado original.
 insert into public.identidad_presencial_overrides(student_id,enrollment_id,actor_id,slot_id,motivo,creado_at)
 values(p_student,e.id,p_actor,null,v_motivo,v_now);
 select id into v_sol from public.solicitudes_inscripcion where student_id=p_student and estado='aprobada'
 order by solicitada_at desc,id limit 1;
 if v_sol is not null then insert into public.solicitud_auditoria(solicitud_id,actor_id,accion)
  values(v_sol,p_actor,'identidad_presencial_admin');end if;
 return jsonb_build_object('transicion',true,'confirmadaAt',v_now,'confirmadaPor',p_actor,'enrollmentId',e.id);
end $$;
revoke all on function public.confirmar_identidad_presencial_admin(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirmar_identidad_presencial_admin(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
