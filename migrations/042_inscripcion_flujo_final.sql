-- F01 / Migración A. Aplicación MANUAL coordinada con el backend F03–F24.
-- Requiere 007–041. No aplicar con el backend antiguo: cambian los estados.
-- Legacy: datos/nombres originales y cuatro documentos se conservan sin reinterpretar.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.solicitudes_inscripcion') is null
     or to_regclass('public.solicitud_consentimientos') is null
     or to_regclass('public.enrollment_documents') is null
     or to_regprocedure('public.revisar_documento_solicitud(uuid,uuid,uuid,text,text)') is null then
    raise exception '042 requiere las migraciones 007–041 completas';
  end if;
end $$;

-- Misma comparación que F04: se conserva correo para entrega, se canoniza solo unicidad.
create or replace function public.normalizar_correo_inscripcion(p_correo text)
returns text language sql immutable strict security invoker set search_path = '' as $$
  select case when split_part(lower(btrim(p_correo)), '@', 2) in ('gmail.com','googlemail.com')
    then replace(split_part(split_part(lower(btrim(p_correo)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else lower(btrim(p_correo)) end
$$;
revoke all on function public.normalizar_correo_inscripcion(text) from public, anon, authenticated;
grant execute on function public.normalizar_correo_inscripcion(text) to service_role;

-- Fallar SIN modificar ni fusionar expedientes si la nueva unicidad colisiona.
do $$ begin
  if exists(select 1 from public.solicitudes_inscripcion
    group by public.normalizar_correo_inscripcion(correo) having count(*) > 1) then
    raise exception 'Hay correos equivalentes en solicitudes; reconciliar manualmente antes de 042 (ver preflight)';
  end if;
end $$;

lock table public.solicitudes_inscripcion in access exclusive mode;
drop trigger if exists solicitudes_fecha_inmutable on public.solicitudes_inscripcion;
alter table public.solicitudes_inscripcion
  add column if not exists nombres text,
  add column if not exists apellidos text,
  add column if not exists nacionalidad_tipo text,
  add column if not exists tipo_sangre text,
  add column if not exists nivel_estudios text,
  add column if not exists devuelta_at timestamptz,
  add column if not exists devuelta_por uuid references public.users(id) on delete restrict,
  add column if not exists devolucion_motivo_codigo text,
  add column if not exists devolucion_mensaje text,
  add column if not exists devolucion_nota_interna text,
  add column if not exists rechazo_motivo_codigo text,
  add column if not exists rechazo_nota_interna text,
  add column if not exists documento_estudios_pendiente_por_cupo boolean not null default false,
  add column if not exists correo_normalizado text generated always as
    (public.normalizar_correo_inscripcion(correo)) stored;

alter table public.solicitudes_inscripcion drop constraint if exists solicitudes_estado_valido;
update public.solicitudes_inscripcion
  set estado = case when enviada_at is null then 'borrador' else 'enviada' end
  where estado = 'pendiente_revision';
alter table public.solicitudes_inscripcion alter column estado set default 'borrador';
alter table public.solicitudes_inscripcion add constraint solicitudes_estado_valido
  check (estado in ('borrador','enviada','devuelta','aprobada','rechazada'));
alter table public.solicitudes_inscripcion drop constraint if exists solicitudes_datos_finales_catalogos;
alter table public.solicitudes_inscripcion add constraint solicitudes_datos_finales_catalogos check (
  (nombres is null or char_length(nombres) between 2 and 60)
  and (apellidos is null or char_length(apellidos) between 2 and 60)
  and (nacionalidad_tipo is null or nacionalidad_tipo in ('ecuatoriana','extranjero_con_cedula'))
  and (tipo_sangre is null or tipo_sangre in ('A+','A-','B+','B-','AB+','AB-','O+','O-','no_sabe'))
  and (nivel_estudios is null or nivel_estudios in
    ('bachiller','bachiller_reciente','bachiller_exterior','decimo_aprobado','cursando_bachillerato'))
);
alter table public.solicitudes_inscripcion drop constraint if exists solicitudes_motivos_finales;
alter table public.solicitudes_inscripcion add constraint solicitudes_motivos_finales check (
  (devolucion_motivo_codigo is null or devolucion_motivo_codigo in
    ('DATOS_NO_COINCIDEN_REGISTRO_CIVIL','CEDULA_MAL_ESCRITA','TITULO_NO_ENCONTRADO_ADJUNTAR_DOCUMENTO',
     'DOCUMENTO_ILEGIBLE_O_INCOMPLETO','REQUIERE_DOCUMENTO_ESTUDIOS','OTRO'))
  and (rechazo_motivo_codigo is null or rechazo_motivo_codigo in
    ('NO_CUMPLE_NIVEL_ESTUDIOS','NO_CUMPLE_EDAD','SOLICITUD_DUPLICADA',
     'DATOS_INCONSISTENTES_O_FALSOS','SPAM','OTRO','VENCIDA'))
  and (devolucion_mensaje is null or char_length(devolucion_mensaje) between 10 and 300)
  and (devolucion_nota_interna is null or char_length(devolucion_nota_interna) <= 1000)
  and (rechazo_nota_interna is null or char_length(rechazo_nota_interna) <= 1000)
);
drop index if exists public.solicitudes_correo_unique;
create unique index if not exists solicitudes_correo_normalizado_unique
  on public.solicitudes_inscripcion(correo_normalizado) where correo_normalizado is not null;
drop index if exists public.solicitudes_cedula_activa_unique;
create unique index solicitudes_cedula_activa_unique on public.solicitudes_inscripcion(cedula)
  where cedula is not null and estado in ('enviada','devuelta','aprobada');
drop index if exists public.solicitudes_enviadas_pendientes_idx;
create index solicitudes_enviadas_pendientes_idx on public.solicitudes_inscripcion(enviada_at,id)
  where estado = 'enviada';
drop index if exists public.solicitudes_borradores_idx;
create index solicitudes_borradores_idx on public.solicitudes_inscripcion(created_at,id)
  where estado = 'borrador';
create index if not exists solicitudes_devueltas_idx on public.solicitudes_inscripcion(devuelta_at,id)
  where estado = 'devuelta';

alter table public.solicitud_consentimientos
  add column if not exists version_terminos text,
  add column if not exists acepto_terminos boolean not null default false;
-- No se presume aceptación de términos en consentimientos anteriores.

alter table public.solicitud_documentos
  alter column storage_path drop not null,
  add column if not exists subtipo text,
  add column if not exists mime_type text,
  add column if not exists size_bytes integer,
  add column if not exists sha256 text,
  add column if not exists archivo_verificado_at timestamptz,
  add column if not exists archivo_eliminado_at timestamptz;
alter table public.solicitud_documentos drop constraint if exists solicitud_documentos_tipo_valido;
alter table public.solicitud_documentos add constraint solicitud_documentos_tipo_valido
  check (tipo_documento in ('cedula','papeleta_votacion','tipo_sangre','titulo_bachiller','certificado_estudios'));
alter table public.solicitud_documentos drop constraint if exists solicitud_certificado_formato;
alter table public.solicitud_documentos add constraint solicitud_certificado_formato check (
  tipo_documento <> 'certificado_estudios' or (
    subtipo is not null and subtipo in ('acta_grado','copia_titulo','certificado_promocion','certificado_estudios','resolucion_homologacion')
    and mime_type is not null and mime_type in ('image/jpeg','application/pdf')
    and size_bytes is not null and size_bytes between 1 and 2097152
    and sha256 is not null and sha256 ~ '^[a-f0-9]{64}$'
    and ((storage_path is not null and archivo_eliminado_at is null)
      or (storage_path is null and archivo_eliminado_at is not null))
  )
);
comment on column public.solicitud_documentos.tipo_documento is
  'Solo nuevas escrituras de certificado_estudios. Otros tipos legacy solo lectura, no reinterpretados.';

-- Sin FK al expediente: conservar prueba técnica tras la purga, igual que auditoría.
create table if not exists public.solicitud_verificaciones (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null,
  tipo text not null check (tipo in ('identidad','estudios')),
  metodo text not null check (metodo in ('registro_civil_portal','registro_civil_web_service',
    'ministerio_portal','codigo_qr_certificado','llamada_institucion','original_presencial','revision_visual')),
  resultado text not null check (resultado in ('verificado','no_coincide','no_encontrado')),
  nota text check (nota is null or char_length(nota) <= 1000),
  actor_id uuid not null references public.users(id) on delete restrict,
  creado_at timestamptz not null default clock_timestamp()
);
comment on column public.solicitud_verificaciones.nota is
  'Nota técnica sin datos personales ni transcripciones. No se expone al postulante.';
create index if not exists solicitud_verificaciones_ultima_idx
  on public.solicitud_verificaciones(solicitud_id,tipo,creado_at desc,id desc);
create or replace function public.impedir_cambio_verificacion() returns trigger
language plpgsql security invoker set search_path = '' as $$ begin
  raise exception 'Las verificaciones son append-only' using errcode = 'SI409';
end $$;
drop trigger if exists solicitud_verificaciones_inmutables on public.solicitud_verificaciones;
create trigger solicitud_verificaciones_inmutables before update or delete on public.solicitud_verificaciones
  for each row execute function public.impedir_cambio_verificacion();
revoke all on function public.impedir_cambio_verificacion() from public,anon,authenticated;

create table if not exists public.correo_bloqueado (
  correo_hash text primary key check (correo_hash ~ '^[a-f0-9]{64}$'),
  hasta timestamptz not null
);
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  inscripciones_abiertas boolean not null default true,
  updated_by uuid references public.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(id) values (true) on conflict(id) do nothing;
create table if not exists public.enrollment_counters (
  dia date not null,
  tipo text not null check (tipo in ('codigos','solicitudes','subidas')),
  usado integer not null check (usado >= 0),
  primary key(dia,tipo)
);
create table if not exists public.enrollment_rate_events (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('codigo_correo','codigo_ip','intento_codigo','subida_ip')),
  clave_hash text not null check (clave_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists enrollment_rate_events_clave_idx
  on public.enrollment_rate_events(tipo,clave_hash,created_at desc);
create index if not exists enrollment_rate_events_retencion_idx
  on public.enrollment_rate_events(created_at);

create or replace function public.consumir_cupo_inscripcion(p_tipo text,p_tope integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_usado integer;
begin
  if p_tipo is null or p_tipo not in ('codigos','solicitudes','subidas') or p_tope is null or p_tope < 0 then
    raise exception 'Contador o tope inválido' using errcode = '22023';
  end if;
  if p_tope = 0 then return null; end if;
  insert into public.enrollment_counters(dia,tipo,usado)
  values ((clock_timestamp() at time zone 'America/Guayaquil')::date,p_tipo,1)
  on conflict(dia,tipo) do update set usado = public.enrollment_counters.usado + 1
    where public.enrollment_counters.usado < p_tope
  returning usado into v_usado;
  return v_usado; -- NULL: cupo agotado; no se incrementa ni se reinicia.
end $$;
revoke all on function public.consumir_cupo_inscripcion(text,integer) from public,anon,authenticated;
grant execute on function public.consumir_cupo_inscripcion(text,integer) to service_role;

alter table public.courses add column if not exists edad_minima integer not null default 18;
alter table public.courses drop constraint if exists courses_edad_minima_valida;
alter table public.courses add constraint courses_edad_minima_valida check (edad_minima between 0 and 100);
alter table public.enrollments
  add column if not exists origen text not null default 'manual',
  add column if not exists requisitos_verificados_at timestamptz,
  add column if not exists identidad_presencial_at timestamptz,
  add column if not exists identidad_presencial_por uuid references public.users(id) on delete restrict,
  add column if not exists certificado_original_visto boolean not null default false;
alter table public.enrollments drop constraint if exists enrollments_origen_valido;
alter table public.enrollments add constraint enrollments_origen_valido check (origen in ('manual','solicitud'));
alter table public.enrollments drop constraint if exists enrollments_identidad_presencial_par;
alter table public.enrollments add constraint enrollments_identidad_presencial_par
  check ((identidad_presencial_at is null) = (identidad_presencial_por is null));
-- Checklist físico existente: conservar nombres y cuatro filas, sin tocar wizard manual.

create or replace function public.protect_solicitud_date() returns trigger
language plpgsql security invoker set search_path = '' as $$ begin
  if tg_op = 'INSERT' then
    if new.nombres is not null and new.apellidos is not null then
      new.nombre_completo := new.nombres || ' ' || new.apellidos;
    end if;
    return new;
  end if;
  if old.solicitada_at is not null then
    new.solicitada_at := old.solicitada_at;
    new.course_id := old.course_id;
  end if;
  if old.enviada_at is not null then new.enviada_at := old.enviada_at; end if;
  if old.estado not in ('borrador','devuelta') and
    row(new.cedula,new.nombre_completo,new.nombres,new.apellidos,new.telefono,new.fecha_nacimiento,
      new.nacionalidad_tipo,new.tipo_sangre,new.nivel_estudios,new.course_id)
    is distinct from
    row(old.cedula,old.nombre_completo,old.nombres,old.apellidos,old.telefono,old.fecha_nacimiento,
      old.nacionalidad_tipo,old.tipo_sangre,old.nivel_estudios,old.course_id) then
    raise exception 'Los datos de la solicitud no se pueden editar en este estado' using errcode = 'SI410';
  end if;
  if new.nombres is not null and new.apellidos is not null then
    new.nombre_completo := new.nombres || ' ' || new.apellidos;
  end if;
  if new.estado <> old.estado and not (
    (old.estado = 'borrador' and new.estado = 'enviada') or
    (old.estado = 'enviada' and new.estado in ('devuelta','aprobada','rechazada')) or
    (old.estado = 'devuelta' and new.estado in ('enviada','rechazada'))
  ) then raise exception 'Transición de solicitud inválida' using errcode = 'SI409'; end if;
  return new;
end $$;
create trigger solicitudes_fecha_inmutable before insert or update on public.solicitudes_inscripcion
  for each row execute function public.protect_solicitud_date();

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
    -- Retención: únicamente retirar la ruta y registrar la eliminación, incluso decididas.
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

-- Sustituir vista y resumen: desaparece documentosPorRevisar.
drop view if exists public.solicitudes_admin;
create view public.solicitudes_admin with (security_invoker = true) as
  select s.*,
    case s.estado when 'enviada' then 0 when 'devuelta' then 1 else 2 end orden_grupo,
    case when s.estado = 'enviada' then s.enviada_at
         when s.estado = 'devuelta' then s.devuelta_at end pendiente_desde,
    case when s.estado in ('aprobada','rechazada') then s.reviewed_at end decidida_at
  from public.solicitudes_inscripcion s where s.estado <> 'borrador';
revoke all on public.solicitudes_admin from public,anon,authenticated;
grant select on public.solicitudes_admin to service_role;
create or replace function public.resumen_solicitudes() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'pendientes',count(*) filter (where estado = 'enviada'),
    'devueltas',count(*) filter (where estado = 'devuelta'),
    'conMasDe48h',count(*) filter (where estado = 'enviada' and enviada_at < now() - interval '48 hours'),
    'inscripcionesAbiertas',(select inscripciones_abiertas from public.app_settings where id))
  from public.solicitudes_inscripcion
$$;

alter table public.solicitud_verificaciones enable row level security;
alter table public.correo_bloqueado enable row level security;
alter table public.app_settings enable row level security;
alter table public.enrollment_counters enable row level security;
alter table public.enrollment_rate_events enable row level security;
revoke all on public.solicitud_verificaciones,public.correo_bloqueado,public.app_settings,
  public.enrollment_counters,public.enrollment_rate_events from public,anon,authenticated,service_role;
grant select,insert on public.solicitud_verificaciones to service_role;
grant select,insert,update,delete on public.correo_bloqueado,public.enrollment_counters,
  public.enrollment_rate_events to service_role;
grant select,update on public.app_settings to service_role;
revoke all on function public.protect_solicitud_date(),public.guard_solicitud_edit(),public.resumen_solicitudes()
  from public,anon,authenticated;
grant execute on function public.resumen_solicitudes() to service_role;
notify pgrst, 'reload schema';
commit;
