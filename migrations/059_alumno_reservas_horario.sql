-- I05/H7. MANUAL después de058. No cambia datos históricos ni funciones de extensiones.
begin;
set local lock_timeout='5s';
set local search_path=pg_catalog,public,extensions,pg_temp;
do $$ declare f text;begin
 foreach f in array array['public.cohort_cupo_ocupado(uuid,uuid)','public.practice_free_instructors(timestamp with time zone[],uuid)',
 'private.assert_student_not_deleting(uuid)','public.set_student_active(uuid,uuid,boolean)','public.delete_student_data(uuid,uuid,timestamptz,text[])'] loop
 if to_regprocedure(f) is null then raise exception '059 requiere058 completa; falta %',f;end if;end loop;
 if not exists(select 1 from pg_attribute where attrelid='public.enrollments'::regclass and attname='etapa_inscripcion' and not attisdropped)
 or to_regclass('public.notifications') is null then raise exception '059 requiere etapas y notificaciones';end if;
 if not exists(select 1 from pg_extension where extname='btree_gist') then raise exception '059 requiere btree_gist existente';end if;
end $$;

create table public.student_schedule_reservations(
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.users(id) on delete cascade,
 enrollment_id uuid not null references public.enrollments(id) on delete cascade,
 cohort_id uuid not null references public.cohorts(id) on delete restrict,
 estado text not null default 'vigente' check(estado in ('vigente','pago_en_curso','liberada','vencida','confirmada')),
 creada_at timestamptz not null default clock_timestamp(),
 expira_at timestamptz not null,
 extensiones integer not null default 0 check(extensiones between 0 and 1),
 pago_iniciado_at timestamptz,
 cerrada_at timestamptz,
 modalidad text not null check(modalidad in ('entre_semana','fin_de_semana')),
 fecha_inicio date not null,
 horas_por_dia integer not null check(horas_por_dia between 1 and 6),
 margen_dias integer not null check(margen_dias between 0 and 60),
 check(isfinite(expira_at) and expira_at>creada_at),
 check((estado in ('vigente','pago_en_curso'))=(cerrada_at is null))
);
create unique index student_schedule_one_live on public.student_schedule_reservations(student_id)
 where estado in ('vigente','pago_en_curso');
create index student_schedule_expiry on public.student_schedule_reservations(expira_at,id)
 where estado in ('vigente','pago_en_curso');
create index student_schedule_enrollment on public.student_schedule_reservations(enrollment_id,creada_at desc);
create table public.student_schedule_holds(
 id uuid primary key default gen_random_uuid(),
 reservation_id uuid not null references public.student_schedule_reservations(id) on delete cascade,
 instructor_id uuid not null references public.users(id) on delete restrict,
 scheduled_at timestamptz not null check(isfinite(scheduled_at)),
 held_from timestamptz not null,
 expira_at timestamptz not null,
 released_at timestamptz,
 check(isfinite(held_from) and isfinite(expira_at) and expira_at>held_from),
 unique(reservation_id,scheduled_at),
 -- Dos ejes temporales: clase y lease. La caducidad libera sin depender del cron.
 exclude using gist(instructor_id with =,
  tsrange(scheduled_at at time zone 'UTC',(scheduled_at at time zone 'UTC')+interval '1 hour','[)') with &&,
  tstzrange(held_from,expira_at,'[)') with &&) where(released_at is null)
);
create table public.student_schedule_daily(
 student_id uuid not null references public.users(id) on delete cascade,
 dia date not null, cantidad integer not null check(cantidad between 1 and 3),primary key(student_id,dia)
);
create table public.student_schedule_events(
 id uuid primary key default gen_random_uuid(),
 reservation_id uuid not null references public.student_schedule_reservations(id) on delete cascade,
 accion text not null check(accion in ('reservada','ampliada','pago_iniciado','liberada','vencida','confirmada')),
 created_at timestamptz not null default clock_timestamp()
);
create index student_schedule_events_reservation on public.student_schedule_events(reservation_id,created_at);
alter table public.student_schedule_reservations enable row level security;
alter table public.student_schedule_holds enable row level security;
alter table public.student_schedule_daily enable row level security;
alter table public.student_schedule_events enable row level security;
revoke all on public.student_schedule_reservations,public.student_schedule_holds,public.student_schedule_daily,
 public.student_schedule_events from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.student_schedule_reservations,public.student_schedule_holds,
 public.student_schedule_daily to service_role;
grant select,insert,delete on public.student_schedule_events to service_role;

create function private.student_reservation_json(p_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select jsonb_build_object('id',r.id,'enrollmentId',r.enrollment_id,'estado',r.estado,
 'expiraAt',r.expira_at,'serverNow',clock_timestamp(),'extensiones',r.extensiones,
 'puedeAmpliar',r.estado='vigente' and r.extensiones<1 and r.expira_at>clock_timestamp(),
 'cohorte',jsonb_build_object('id',c.id,'nombre',c.nombre),
 'franjas',(select coalesce(jsonb_agg(jsonb_build_object('scheduledAt',h.scheduled_at)
 order by h.scheduled_at),'[]'::jsonb) from public.student_schedule_holds h where h.reservation_id=r.id))
 from public.student_schedule_reservations r join public.cohorts c on c.id=r.cohort_id where r.id=p_id
$$;
-- Llamante bloquea usuario→matrícula→reserva. Liberar no adquiere lock de cohorte:
-- solo resta ocupación y nunca espera una escritura de otro usuario.
create function private.close_student_reservation(p_id uuid,p_estado text) returns void
language plpgsql security invoker set search_path='' as $$ declare r public.student_schedule_reservations;begin
 if p_estado not in ('liberada','vencida') or p_estado is null then raise exception 'Cierre inválido' using errcode='22023';end if;
 update public.student_schedule_reservations set estado=p_estado,cerrada_at=clock_timestamp()
 where id=p_id and estado in ('vigente','pago_en_curso') returning * into r;
 if not found then return;end if;
 update public.student_schedule_holds set released_at=clock_timestamp() where reservation_id=p_id and released_at is null;
 update public.enrollments set etapa_inscripcion='por_agendar',cohort_id=null,reserva_expira_at=null
 where id=r.enrollment_id and etapa_inscripcion='reservado';
 insert into public.student_schedule_events(reservation_id,accion) values(p_id,p_estado);
 if p_estado='vencida' then
 insert into public.notifications(user_id,tipo,titulo,mensaje) values(r.student_id,'cambio_realizado',
 'Tu reserva de horario venció','Las franjas y el cupo se liberaron. Puedes elegir otro horario en Mi inscripción; tu solicitud aprobada se conserva.');
 end if;
end $$;
create function public.expire_student_reservations(p_student uuid) returns integer
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r record;n integer:=0;begin
 perform 1 from public.users where id=p_student and rol='estudiante' for update;
 if not found then return 0;end if;
 perform 1 from public.enrollments where student_id=p_student order by id for update;
 for r in select id from public.student_schedule_reservations where student_id=p_student
 and estado in ('vigente','pago_en_curso') and expira_at<=clock_timestamp() order by id for update loop
 perform private.close_student_reservation(r.id,'vencida');n:=n+1;end loop;
 return n;
end $$;

-- La sugerencia manual conserva su lógica y orden, añadiendo las reservas vigentes.
create or replace function public.practice_free_instructors(p_scheduled_ats timestamptz[],p_instructor_id uuid default null)
returns table(id uuid,nombre_completo text) language sql volatile security invoker set search_path='' as $$
 select u.id,u.nombre_completo::text from public.users u where u.rol='instructor' and u.activo
 and(p_instructor_id is null or u.id=p_instructor_id) and cardinality(p_scheduled_ats)>0
 and not exists(select 1 from public.practice_slots s cross join unnest(p_scheduled_ats) requested(start_at)
 where s.instructor_id=u.id and s.status in ('disponible','asignado','confirmado','liberado','completado')
 and tsrange(s.scheduled_at at time zone 'UTC',(s.scheduled_at at time zone 'UTC')+interval '1 hour','[)')
 && tsrange(requested.start_at at time zone 'UTC',(requested.start_at at time zone 'UTC')+interval '1 hour','[)'))
 and not exists(select 1 from public.student_schedule_holds h cross join unnest(p_scheduled_ats) requested(start_at)
 where h.instructor_id=u.id and h.released_at is null and h.expira_at>clock_timestamp()
 and tsrange(h.scheduled_at at time zone 'UTC',(h.scheduled_at at time zone 'UTC')+interval '1 hour','[)')
 && tsrange(requested.start_at at time zone 'UTC',(requested.start_at at time zone 'UTC')+interval '1 hour','[)'))
 order by u.nombre_completo,u.id
$$;
-- Consulta interna por lote; el backend limita el plan propio antes de invocarla.
create function public.student_schedule_free_slots(p_slots timestamptz[]) returns table(scheduled_at timestamptz,libre boolean)
language plpgsql security invoker set search_path='' as $$ begin
 if p_slots is null or cardinality(p_slots) not between 1 and 8000
 or exists(select 1 from unnest(p_slots) t where t is null or not isfinite(t)) then
 raise exception 'Consulta de franjas inválida' using errcode='22023';end if;
 return query select t, t>clock_timestamp() and exists(select 1 from public.practice_free_instructors(array[t]))
 from (select distinct unnest(p_slots) as t) requested order by t;
end $$;
-- Todas las escrituras físicas comparten el mismo lock breve con reservar/confirmar.
-- Cohorte ANTES del coordinador: evita invertir con el lock de cupo de058.
create function public.guard_practice_schedule_holds() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if new.status not in ('disponible','asignado','confirmado','liberado','completado') then return new;end if;
 perform 1 from public.cohorts where id=new.cohort_id for key share;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 if exists(select 1 from public.student_schedule_holds h join public.student_schedule_reservations r on r.id=h.reservation_id
 where (h.instructor_id=new.instructor_id or r.student_id=new.student_id)
 and h.released_at is null and h.expira_at>clock_timestamp()
 and tsrange(h.scheduled_at at time zone 'UTC',(h.scheduled_at at time zone 'UTC')+interval '1 hour','[)')
 && tsrange(new.scheduled_at at time zone 'UTC',(new.scheduled_at at time zone 'UTC')+interval '1 hour','[)')) then
 raise exception 'Franja reservada por una inscripción' using errcode='IR409';end if;
 return new;
end $$;
create trigger practice_slots_00_schedule_holds before insert or update of scheduled_at,instructor_id,cohort_id,status
 on public.practice_slots for each row execute function public.guard_practice_schedule_holds();

create function public.reserve_student_schedule(p_student uuid,p_enrollment uuid,p_slots timestamptz[],
 p_modalidad text,p_inicio date,p_horas integer,p_ttl integer default 15,p_max_dia integer default 3,p_margen integer default 5)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.enrollments;c public.cohorts;r uuid;v_now timestamptz;v_end timestamptz;v_day date;
 v_total integer;v_count integer;v_instructor uuid;t timestamptz;d date;v_dates date[];v_expected date[]:='{}';
begin
 if p_student is null or p_enrollment is null or p_ttl is null or p_ttl not between 1 and 15
 or p_max_dia is null or p_max_dia not between 1 and 3 or p_margen is null or p_margen not between 0 and 60
 or p_horas is null or p_horas not between 1 and 6 or p_inicio is null
 or p_modalidad is null or p_modalidad not in ('entre_semana','fin_de_semana')
 or p_slots is null or cardinality(p_slots) not between 1 and 500 then
 raise exception 'Plan inválido' using errcode='22023';end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then raise exception 'Cuenta inactiva' using errcode='IR403';end if;
 perform private.assert_student_not_deleting(p_student);
 perform public.expire_student_reservations(p_student);
 select * into e from public.enrollments where id=p_enrollment and student_id=p_student for update;
 if not found then raise exception 'Matrícula no encontrada' using errcode='IR404';end if;
 if e.origen<>'solicitud' or e.etapa_inscripcion<>'por_agendar' or e.status<>'pendiente_cohorte'
 or e.requisitos_verificados_at is null then raise exception 'Matrícula no reservable' using errcode='IR403';end if;
 if exists(select 1 from public.student_schedule_reservations where student_id=p_student and estado in ('vigente','pago_en_curso')) then
 raise exception 'Ya tienes una reserva vigente' using errcode='IR410';end if;
 select horas_requeridas into v_total from public.courses where id=e.course_id for share;
 if v_total is null or v_total<1 or v_total<>cardinality(p_slots) then raise exception 'El plan no cubre las horas del curso' using errcode='22023';end if;
 select array_agg(distinct (s at time zone 'America/Guayaquil')::date order by (s at time zone 'America/Guayaquil')::date)
 into v_dates from unnest(p_slots) s;
 v_day:=(clock_timestamp() at time zone 'America/Guayaquil')::date;
 if p_inicio<v_day or p_inicio>v_day+365 then raise exception 'Fecha de inicio inválida' using errcode='22023';end if;
 -- Mismas fechas civiles del motor manual, última sesión parcial si hace falta.
 d:=p_inicio;
 while cardinality(v_expected)<ceil(v_total::numeric/p_horas)::integer loop
 if (extract(isodow from d) in (6,7))=(p_modalidad='fin_de_semana') then v_expected:=array_append(v_expected,d);end if;
 d:=d+1;
 end loop;
 if v_dates is distinct from v_expected or (select count(distinct s) from unnest(p_slots) s)<>v_total then
 raise exception 'Fechas de plan inválidas' using errcode='22023';end if;
 foreach d in array v_dates loop
 v_count:=case when d=v_dates[cardinality(v_dates)] then v_total-p_horas*(cardinality(v_dates)-1) else p_horas end;
 if (select count(*) from unnest(p_slots) s where (s at time zone 'America/Guayaquil')::date=d)<>v_count then
 raise exception 'Horas por día inválidas' using errcode='22023';end if;
 end loop;
 foreach t in array p_slots loop
 if t is null or not isfinite(t) or t<=clock_timestamp() or date_trunc('hour',t)<>t
 or extract(hour from t at time zone 'America/Guayaquil') not between 6 and 21 then
 raise exception 'Franja fuera de horario' using errcode='22023';end if;
 end loop;
 -- Primera cohorte elegible por inicio e id, siempre bloqueada antes de contar.
 for c in select * from public.cohorts where course_id=e.course_id order by fecha_inicio_curso,id for update loop
 v_day:=(clock_timestamp() at time zone 'America/Guayaquil')::date;
 if v_day between c.fecha_inicio_matricula and c.fecha_fin_matricula
 and v_dates[1]>=c.fecha_inicio_curso and v_dates[cardinality(v_dates)]<=c.fecha_fin_curso-p_margen
 and public.cohort_cupo_ocupado(c.id,e.id)<c.cupo_maximo then exit;end if;
 c:=null;
 end loop;
 if c.id is null then raise exception 'No hay cohorte con cupo que contenga tu plan' using errcode='IR422';end if;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 -- Releer reloj tras esperar todos los locks. Un horario pasado nunca se reserva.
 v_now:=clock_timestamp();v_day:=(v_now at time zone 'America/Guayaquil')::date;
 if exists(select 1 from unnest(p_slots) s where s<=v_now) or v_day not between c.fecha_inicio_matricula and c.fecha_fin_matricula then
 raise exception 'El horario cambió; vuelve a consultar' using errcode='IR409';end if;
 if exists(select 1 from public.practice_slots s cross join unnest(p_slots) x(t) where s.student_id=p_student
 and s.status in ('asignado','confirmado','completado') and abs(extract(epoch from(s.scheduled_at-x.t)))<3600) then
 raise exception 'El alumno ya tiene prácticas en ese horario' using errcode='IR409';end if;
 insert into public.student_schedule_daily(student_id,dia,cantidad) values(p_student,v_day,1)
 on conflict(student_id,dia) do update set cantidad=public.student_schedule_daily.cantidad+1
 where public.student_schedule_daily.cantidad<p_max_dia returning cantidad into v_count;
 if not found then raise exception 'Alcanzaste el máximo de reservas del día' using errcode='IR429';end if;
 v_end:=v_now+make_interval(mins=>p_ttl);
 insert into public.student_schedule_reservations(student_id,enrollment_id,cohort_id,creada_at,expira_at,modalidad,fecha_inicio,horas_por_dia,margen_dias)
 values(p_student,e.id,c.id,v_now,v_end,p_modalidad,p_inicio,p_horas,p_margen) returning id into r;
 for t in select s from unnest(p_slots) s order by s loop
 select id into v_instructor from public.practice_free_instructors(array[t]) limit 1;
 if not found then raise exception 'Una franja ya no está libre' using errcode='IR409';end if;
 -- SHARE del instructor serializa su desactivación sin revelar su identidad al cliente.
 perform 1 from public.users where id=v_instructor and activo for share;
 if not found then raise exception 'Disponibilidad actualizada; vuelve a consultar' using errcode='IR409';end if;
 insert into public.student_schedule_holds(reservation_id,instructor_id,scheduled_at,held_from,expira_at)
 values(r,v_instructor,t,v_now,v_end);
 end loop;
 if v_end<=clock_timestamp() or exists(select 1 from unnest(p_slots) x where x<=clock_timestamp()) then raise exception 'La reserva caducó al esperar; vuelve a consultar' using errcode='IR409';end if;
 update public.enrollments set etapa_inscripcion='reservado',cohort_id=c.id,reserva_expira_at=v_end where id=e.id;
 insert into public.student_schedule_events(reservation_id,accion) values(r,'reservada');
 return private.student_reservation_json(r);
end $$;

create function public.manage_student_reservation(p_student uuid,p_accion text,p_id uuid default null,
 p_extension integer default 10,p_max_extensiones integer default 1,p_gracia integer default 10)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.student_schedule_reservations;v_now timestamptz;v_end timestamptz;begin
 if p_accion is null or p_accion not in ('actual','ampliar','liberar','iniciar_pago') or p_extension is null or p_extension not between 1 and 10
 or p_max_extensiones is null or p_max_extensiones not between 0 and 1 or p_gracia is null or p_gracia not between 1 and 10 then
 raise exception 'Acción inválida' using errcode='22023';end if;
 perform 1 from public.users where id=p_student and rol='estudiante' and activo for update;
 if not found then raise exception 'Cuenta inactiva' using errcode='IR403';end if;
 perform private.assert_student_not_deleting(p_student);
 perform public.expire_student_reservations(p_student);
 select * into r from public.student_schedule_reservations where student_id=p_student
 and(p_id is null or id=p_id) order by creada_at desc,id limit 1 for update;
 if not found then
 if p_accion='actual' then return null;end if;
 raise exception 'Reserva no encontrada' using errcode='IR404';end if;
 if p_accion='actual' then return private.student_reservation_json(r.id);end if;
 if p_accion='liberar' and r.estado in ('liberada','vencida') then return private.student_reservation_json(r.id);end if;
 if r.estado not in ('vigente','pago_en_curso') then
 -- No excepción tras limpieza: una excepción revertiría la expiración perezosa.
 return private.student_reservation_json(r.id);end if;
 if p_accion='liberar' then
 if r.estado='pago_en_curso' then raise exception 'Hay un pago en curso; espera el resultado' using errcode='IR412';end if;
 perform private.close_student_reservation(r.id,'liberada');return private.student_reservation_json(r.id);end if;
 if p_accion='ampliar' and(r.estado<>'vigente' or r.extensiones>=p_max_extensiones) then
 raise exception 'No puedes ampliar esta reserva' using errcode='IR411';end if;
 if p_accion='iniciar_pago' and r.estado='pago_en_curso' then return private.student_reservation_json(r.id);end if;
 perform 1 from public.cohorts where id=r.cohort_id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 v_now:=clock_timestamp();
 if r.expira_at<=v_now or exists(select 1 from public.student_schedule_holds where reservation_id=r.id and scheduled_at<=v_now) then perform private.close_student_reservation(r.id,'vencida');return private.student_reservation_json(r.id);end if;
 v_end:=case when p_accion='ampliar' then r.expira_at+make_interval(mins=>p_extension)
 else greatest(r.expira_at,v_now+make_interval(mins=>p_gracia)) end;
 update public.student_schedule_holds set expira_at=v_end where reservation_id=r.id and released_at is null;
 update public.student_schedule_reservations set expira_at=v_end,
 extensiones=extensiones+case when p_accion='ampliar' then 1 else 0 end,
 estado=case when p_accion='iniciar_pago' then 'pago_en_curso' else estado end,
 pago_iniciado_at=case when p_accion='iniciar_pago' then v_now else pago_iniciado_at end where id=r.id;
 update public.enrollments set reserva_expira_at=v_end where id=r.enrollment_id and etapa_inscripcion='reservado';
 insert into public.student_schedule_events(reservation_id,accion) values(r.id,case when p_accion='ampliar' then 'ampliada' else 'pago_iniciado' end);
 return private.student_reservation_json(r.id);
end $$;

-- Solo I10 puede llamarla dentro de su transacción de pago. No concede activación.
-- Si llega tarde revalida cupo/franjas bajo locks, o falla IR409 para revisión de dinero.
create function private.confirm_student_reservation(p_student uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.student_schedule_reservations;e public.enrollments;h record;v_instructor uuid;begin
 perform 1 from public.users where id=p_student and rol='estudiante' and activo and status='activo' for update;
 if not found then raise exception 'Confirmación requiere pago confirmado' using errcode='IR403';end if;
 perform private.assert_student_not_deleting(p_student);
 select * into e from public.enrollments where student_id=p_student
 and id=(select enrollment_id from public.student_schedule_reservations where id=p_id and student_id=p_student) for update;
 if not found or e.origen<>'solicitud' or e.etapa_inscripcion<>'activa' or e.status<>'activo' then
 raise exception 'Confirmación requiere matrícula activada por pago' using errcode='IR403';end if;
 select * into r from public.student_schedule_reservations where id=p_id and student_id=p_student for update;
 if r.estado='confirmada' then return private.student_reservation_json(r.id);end if;
 if r.cohort_id is distinct from e.cohort_id or r.estado='liberada' then raise exception 'Reserva no confirmable' using errcode='IR409';end if;
 perform 1 from public.cohorts where id=r.cohort_id for update;
 perform pg_advisory_xact_lock(hashtextextended('student_schedule_write',0));
 if not exists(select 1 from public.student_schedule_holds where reservation_id=r.id)
 or exists(select 1 from public.student_schedule_holds where reservation_id=r.id and scheduled_at<=clock_timestamp()) then
 raise exception 'El horario ya venció; requiere revisión del pago' using errcode='IR409';end if;
 -- Libera solo su lease, sin abrir ventana a otros escritores hasta el commit.
 update public.student_schedule_holds set released_at=clock_timestamp() where reservation_id=r.id;
 for h in select scheduled_at,instructor_id from public.student_schedule_holds where reservation_id=r.id order by scheduled_at loop
 select id into v_instructor from public.practice_free_instructors(array[h.scheduled_at],h.instructor_id) limit 1;
 if not found then select id into v_instructor from public.practice_free_instructors(array[h.scheduled_at]) limit 1;end if;
 if v_instructor is null then raise exception 'Franjas ocupadas; requiere revisión del pago' using errcode='IR409';end if;
 insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status)
 values(r.cohort_id,v_instructor,p_student,h.scheduled_at,60,'asignado');
 end loop;
 update public.student_schedule_reservations set estado='confirmada',cerrada_at=clock_timestamp() where id=r.id;
 insert into public.student_schedule_events(reservation_id,accion) values(r.id,'confirmada');
 return private.student_reservation_json(r.id);
end $$;

create function public.release_inactive_student_reservations() returns trigger
language plpgsql security invoker set search_path='' as $$ declare r record;begin
 if not new.activo and old.activo and new.rol='estudiante' then
 perform 1 from public.enrollments where student_id=new.id order by id for update;
 for r in select id from public.student_schedule_reservations where student_id=new.id
 and estado in ('vigente','pago_en_curso') order by id for update loop
 perform private.close_student_reservation(r.id,'liberada');end loop;end if;
 return new;
end $$;
create trigger users_release_schedule_reservations after update of activo on public.users
 for each row execute function public.release_inactive_student_reservations();
-- No eliminar instructors de holds históricos; la desactivación se permite y se
-- revalida al confirmar. Alumno/matrícula se borran por cascade con el flujo026.
create function public.guard_cohort_schedule_reservations() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if exists(select 1 from public.student_schedule_reservations r join public.student_schedule_holds h on h.reservation_id=r.id
 where r.cohort_id=new.id and r.estado in ('vigente','pago_en_curso') and r.expira_at>clock_timestamp()
 and(new.course_id<>old.course_id or new.precio<>old.precio
 or (h.scheduled_at at time zone 'America/Guayaquil')::date<new.fecha_inicio_curso
 or (h.scheduled_at at time zone 'America/Guayaquil')::date>new.fecha_fin_curso-r.margen_dias)) then
 raise exception 'La cohorte tiene reservas vigentes; conserva curso, precio y fechas compatibles' using errcode='IR413';end if;
 return new;
end $$;
create trigger cohorts_schedule_reservations before update of course_id,precio,fecha_inicio_curso,fecha_fin_curso on public.cohorts
 for each row execute function public.guard_cohort_schedule_reservations();

revoke all on function private.student_reservation_json(uuid),private.close_student_reservation(uuid,text),
 private.confirm_student_reservation(uuid,uuid),public.expire_student_reservations(uuid),
 public.practice_free_instructors(timestamptz[],uuid),public.student_schedule_free_slots(timestamptz[]),public.guard_practice_schedule_holds(),
 public.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer),
 public.manage_student_reservation(uuid,text,uuid,integer,integer,integer),
 public.release_inactive_student_reservations(),public.guard_cohort_schedule_reservations() from public,anon,authenticated;
grant execute on function private.student_reservation_json(uuid),private.close_student_reservation(uuid,text),
 private.confirm_student_reservation(uuid,uuid),public.expire_student_reservations(uuid),
 public.practice_free_instructors(timestamptz[],uuid),public.student_schedule_free_slots(timestamptz[]),public.guard_practice_schedule_holds(),
 public.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer),
 public.manage_student_reservation(uuid,text,uuid,integer,integer,integer),
 public.release_inactive_student_reservations(),public.guard_cohort_schedule_reservations() to service_role;
notify pgrst,'reload schema';
commit;
