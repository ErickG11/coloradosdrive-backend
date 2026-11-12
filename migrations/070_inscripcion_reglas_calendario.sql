-- L2. Reglas puras internas; no reemplaza lectores legacy. Indicador apagado.
begin;
set local lock_timeout='5s';
create or replace function private.raise_cohort_error(p_code text,p_details jsonb default '{}'::jsonb)
returns void language plpgsql security invoker set search_path='' as $$ begin
 raise exception using errcode='P7000',message=p_code,detail=p_details::text;
end $$;
create or replace function private.enrollment_plan_v2(p_input jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare v_start date; v_day date; v_mode text; v_hours int; v_hour int; v_left int:=15;
 v_n int; v_i int; v_slots jsonb:='[]'; v_days jsonb:='[]'; v_first date; v_last date;
begin
 v_start:=private.lote1_date(p_input->>'fechaInicio');v_mode:=p_input->>'modalidad';
 if v_start is null or v_mode is null or v_mode not in ('entre_semana','fin_de_semana')
  or coalesce(p_input->>'horasPorDia','') !~ '^[1-6]$'
  or coalesce(p_input->>'horaInicio','') !~ '^([0-9]|1[0-9]|2[01])$' then
  perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 v_hours:=(p_input->>'horasPorDia')::int;v_hour:=(p_input->>'horaInicio')::int;
 if v_hour<6 or v_hour+v_hours>22 then perform private.raise_cohort_error('PLAN_ENTRADA_INVALIDA');end if;
 v_day:=v_start;
 while v_left>0 loop
  if (v_mode='entre_semana' and extract(isodow from v_day) between 1 and 5)
    or (v_mode='fin_de_semana' and extract(isodow from v_day) in (6,7)) then
   v_n:=least(v_left,v_hours);v_first:=coalesce(v_first,v_day);v_last:=v_day;
   v_days:=v_days||jsonb_build_array(jsonb_build_object('fecha',v_day,'horas',v_n));
   for v_i in 0..v_n-1 loop
    v_slots:=v_slots||jsonb_build_array(to_char((v_day::timestamp+make_interval(hours=>v_hour+v_i))
      at time zone 'America/Guayaquil' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
   end loop;
   v_left:=v_left-v_n;
  end if;
  v_day:=v_day+1;
 end loop;
 return jsonb_build_object('fechaInicioEfectiva',v_first,'ultimaFecha',v_last,'totalHoras',15,'dias',v_days,'franjas',v_slots);
end $$;
create or replace function private.assert_enrollment_plan_future(p_plan jsonb,p_now timestamptz)
returns void language plpgsql immutable security invoker set search_path='' as $$ begin
 if (p_plan->>'fechaInicioEfectiva')::date < (p_now at time zone 'America/Guayaquil')::date then
  perform private.raise_cohort_error('PLAN_INICIO_PASADO');end if;
 if exists(select 1 from jsonb_array_elements_text(p_plan->'franjas') slot where slot::timestamptz<=p_now) then
  perform private.raise_cohort_error('PLAN_FRANJA_PASADA');end if;
end $$;
create or replace function private.cohort_calendar_v2(p_start date,p_end date,p_practice_start date,
 p_practice_end date,p_enabled boolean,p_now timestamptz) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare v_cutoff date;v_open boolean;v_finished boolean;v_exclusive timestamptz;begin
 if p_start is null or p_end is null or p_practice_start is null or p_practice_end is null
   or not isfinite(p_start) or not isfinite(p_end) or not isfinite(p_practice_start) or not isfinite(p_practice_end)
   or p_start>p_end or p_end>p_practice_end or p_practice_start>p_practice_end then
   perform private.raise_cohort_error('COHORTE_FECHAS_INVALIDAS');end if;
 v_cutoff:=p_end-5;v_exclusive:=(v_cutoff+1)::timestamp at time zone 'America/Guayaquil';
 v_finished:=p_now >= (p_practice_end+1)::timestamp at time zone 'America/Guayaquil';
 v_open:=not v_finished and coalesce(p_enabled,false) and p_now>=p_start::timestamp at time zone 'America/Guayaquil' and p_now<v_exclusive;
 return jsonb_build_object('cutoff',v_cutoff,'cutoffExclusive',to_char(v_exclusive at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'open',v_open,'finished',v_finished,'state',case when v_finished then 'terminada' when v_open then 'matricula_abierta' else 'matricula_cerrada_en_curso' end);
end $$;
create or replace function private.enrollment_rule_enabled(p_key text) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select enabled and implemented from public.enrollment_rule_flags where key=p_key),false)
$$;
revoke all on function private.raise_cohort_error(text,jsonb),private.enrollment_plan_v2(jsonb),
 private.assert_enrollment_plan_future(jsonb,timestamptz),
 private.cohort_calendar_v2(date,date,date,date,boolean,timestamptz),private.enrollment_rule_enabled(text)
 from public,anon,authenticated;
grant execute on function private.raise_cohort_error(text,jsonb),private.enrollment_plan_v2(jsonb),
 private.assert_enrollment_plan_future(jsonb,timestamptz),
 private.cohort_calendar_v2(date,date,date,date,boolean,timestamptz),private.enrollment_rule_enabled(text) to service_role;
update public.enrollment_rule_flags set implemented=true,enabled=false where key='date_rules';
commit;
