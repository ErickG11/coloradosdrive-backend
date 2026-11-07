-- CC-01/CC-02. Aplicación manual después de 036. Repetible sin borrar datos.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.solicitudes_inscripcion') is null
     or to_regclass('public.solicitud_documentos') is null
     or to_regclass('public.enrollment_documents') is null then
    raise exception 'Faltan dependencias 007, 015, 022';
  end if;
end $$;
alter table public.solicitudes_inscripcion add column if not exists solicitada_at timestamptz;
alter table public.solicitud_documentos add column if not exists reviewed_by uuid references public.users(id) on delete restrict;
create table if not exists public.solicitud_consentimientos (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes_inscripcion(id) on delete cascade,
  version_aviso text not null,
  acepto_tratamiento boolean not null check (acepto_tratamiento),
  declara_veracidad boolean not null check (declara_veracidad),
  aceptado_at timestamptz not null default now(),
  representante_nombre text,
  representante_cedula text check (representante_cedula is null or representante_cedula ~ '^[0-9]{10}$'),
  representante_acepta boolean not null default false,
  unique(solicitud_id, version_aviso),
  check (not representante_acepta or (nullif(trim(representante_nombre),'') is not null and representante_cedula is not null))
);
-- Sin FK al expediente: el evento sobrevive al derecho de eliminación.
-- Los UUID son identificadores técnicos; nunca copiar nombre, correo o cédula aquí.
create table if not exists public.solicitud_auditoria (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null,
  actor_id uuid,
  accion text not null,
  documento_id uuid,
  creado_at timestamptz not null default now()
);
create index if not exists solicitud_auditoria_expediente_idx on public.solicitud_auditoria(solicitud_id, creado_at);
alter table public.solicitud_consentimientos enable row level security;
alter table public.solicitud_auditoria enable row level security;
revoke all on public.solicitud_consentimientos, public.solicitud_auditoria from public, anon, authenticated;
grant select, insert, update, delete on public.solicitud_consentimientos to service_role;
grant select, insert on public.solicitud_auditoria to service_role;
-- Evita que dos guardados concurrentes reescriban la fecha/curso originales.
create or replace function public.protect_solicitud_date() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.solicitada_at is not null then
    new.solicitada_at := old.solicitada_at;
    new.course_id := old.course_id;
  end if;
  return new;
end $$;
drop trigger if exists solicitudes_fecha_inmutable on public.solicitudes_inscripcion;
create trigger solicitudes_fecha_inmutable before update on public.solicitudes_inscripcion
for each row execute function public.protect_solicitud_date();
revoke all on function public.protect_solicitud_date() from public, anon, authenticated;
commit;
