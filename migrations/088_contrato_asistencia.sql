-- C14. Aplicación manual; sin activar indicadores.
begin;
set local lock_timeout='5s';
-- GUARDA-C14-NUEVAS INICIO
do $guard$ begin if to_regprocedure('private.write_practice_contract_v14()') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.write_practice_contract_v14()')) is distinct from 'bc246e4370f15426d192f5b7bd7d05df' then raise exception 'GUARDA_088: función C14 alterada: private.write_practice_contract_v14()';end if;end $guard$;
do $guard$ begin if to_regprocedure('private.resolve_practice_contract_v14(enrollments)') is not null and (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.resolve_practice_contract_v14(enrollments)')) is distinct from '63409564a3b7ca540b85c1919968a8ab' then raise exception 'GUARDA_088: función C14 alterada: private.resolve_practice_contract_v14(enrollments)';end if;end $guard$;
-- GUARDA-C14-NUEVAS FIN
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.reserve_schedule_v2(uuid,uuid,jsonb)')) is distinct from 'b6b2ee2afd0866b255ccaa9ef1fbd26c' then raise exception 'GUARDA_088: private.reserve_schedule_v2(uuid,uuid,jsonb) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)')) is distinct from '6fbf8dea16054980095bd760988b2baf' then raise exception 'GUARDA_088: private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.confirm_plan_change_v2(uuid,uuid,uuid)')) is distinct from '7367c7611d0c2eba97f64f2d8aa422c6' then raise exception 'GUARDA_088: private.confirm_plan_change_v2(uuid,uuid,uuid) no coincide con la instalación esperada';end if;end $guard$;
do $guard$ begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.integrated_manual_commit_v2(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamp with time zone[],uuid,jsonb,jsonb)')) is distinct from '294934f121eb4be6e46b41cf1e427342' then raise exception 'GUARDA_088: private.integrated_manual_commit_v2(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamp with time zone[],uuid,jsonb,jsonb) no coincide con la instalación esperada';end if;end $guard$;
-- Contrato demostrado: la reserva es la fuente; el histórico ambiguo permanece intacto.
create table if not exists private.practice_contract_backfill_v14(
 enrollment_id uuid primary key, previous_plan jsonb, applied_plan jsonb not null, previous_updated_at timestamptz
);
revoke all on private.practice_contract_backfill_v14 from public,anon,authenticated,service_role;
create or replace function private.resolve_practice_contract_v14(p_e public.enrollments)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_mode text;v_daily integer;v_candidates jsonb[];v_plan jsonb:=coalesce(p_e.practice_plan,'{}');
begin
 if p_e.practice_start_date is null or p_e.practice_end_date is null or p_e.horas_practica_objetivo is null then return null;end if;
 -- Cada reserva candidata debe demostrar las fechas y el objetivo con sus retenciones históricas.
 select array_agg(distinct jsonb_build_object('modalidad',r.modalidad,'horasPorDia',r.horas_por_dia)) into v_candidates
 from public.student_schedule_reservations r where r.enrollment_id=p_e.id and r.student_id=p_e.student_id
 and r.cohort_id=p_e.cohort_id and (r.estado='confirmada' or (pg_trigger_depth()>0 and r.estado in('vigente','pago_en_curso')))
 and r.practice_start_date=p_e.practice_start_date and r.practice_end_date=p_e.practice_end_date
 and (select count(*) from public.student_schedule_holds h where h.reservation_id=r.id)=p_e.horas_practica_objetivo
 and (select min((h.scheduled_at at time zone 'America/Guayaquil')::date) from public.student_schedule_holds h where h.reservation_id=r.id)=p_e.practice_start_date
 and (select max((h.scheduled_at at time zone 'America/Guayaquil')::date) from public.student_schedule_holds h where h.reservation_id=r.id)=p_e.practice_end_date;
 if cardinality(v_candidates)=1 then
  v_mode:=v_candidates[1]->>'modalidad';v_daily:=(v_candidates[1]->>'horasPorDia')::integer;
 elsif v_plan->>'modalidad' in('entre_semana','fin_de_semana') and coalesce(v_plan->>'horasPorDia','') ~ '^[1-6]$'
 and p_e.individual_dates_source='practice_plan' then
  -- La matrícula manual guarda el input validado y las fechas canónicas en la misma escritura.
  v_mode:=v_plan->>'modalidad';v_daily:=(v_plan->>'horasPorDia')::integer;
 else return null;end if;
 if v_mode not in('entre_semana','fin_de_semana') or v_daily not between 1 and 6 then return null;end if;
 return v_plan||jsonb_build_object('fechaFinElegida',p_e.practice_end_date,'modalidad',v_mode,
 'horasPorDia',v_daily,'horas',p_e.horas_practica_objetivo);
end $$;
create or replace function private.write_practice_contract_v14() returns trigger
language plpgsql security invoker set search_path='' as $$declare v_plan jsonb;begin
 v_plan:=private.resolve_practice_contract_v14(new);
 if v_plan is not null then new.practice_plan:=v_plan;end if;return new;
end $$;
drop trigger if exists enrollments_02_practice_contract_v14 on public.enrollments;
create trigger enrollments_02_practice_contract_v14 before insert or update of practice_plan,practice_start_date,practice_end_date,cohort_id,horas_practica_objetivo,etapa_inscripcion
 on public.enrollments for each row execute function private.write_practice_contract_v14();
-- Solo los NULL demostrables se rellenan. Se conserva el valor anterior para rollback exacto.
insert into private.practice_contract_backfill_v14(enrollment_id,previous_plan,applied_plan,previous_updated_at)
 select e.id,e.practice_plan,private.resolve_practice_contract_v14(e),e.updated_at from public.enrollments e
 where e.practice_plan is null and private.resolve_practice_contract_v14(e) is not null on conflict do nothing;
update public.enrollments e set practice_plan=b.applied_plan from private.practice_contract_backfill_v14 b
 where e.id=b.enrollment_id and e.practice_plan is null;
grant update(practice_plan) on public.enrollments to service_role;

-- Todas las funciones C14 son exclusivas del backend, incluidas las llamadas por disparadores.
do $acl$ declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in ('resolve_practice_contract_v14','write_practice_contract_v14') loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end $acl$;
notify pgrst, 'reload schema';
commit;
