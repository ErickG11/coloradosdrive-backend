-- 007_solicitudes_inscripcion.sql
-- Solicitudes de inscripción online (con documentos), previas a que exista
-- cuenta de estudiante. La cuenta real se crea solo cuando el admin aprueba
-- la solicitud (solicitudes_inscripcion.student_id se llena en ese momento).

-- =========================================================================
-- solicitudes_inscripcion
-- =========================================================================
-- Una fila nace en el paso de verificación de correo (solo con `correo`);
-- cedula/nombre/fecha_nacimiento se completan después (PUT
-- /solicitudes/:id/datos), por eso son nullable. `estado` sigue siendo
-- 'pendiente_revision' mientras la solicitud está en progreso o esperando
-- revisión del admin.
create table solicitudes_inscripcion (
  id uuid primary key default gen_random_uuid(),
  cedula text,
  nombre_completo text,
  telefono text,
  correo text not null,
  fecha_nacimiento date,
  correo_verificado boolean not null default false,
  -- SHA-256 (hex) del código de 6 dígitos, no el código en claro: un
  -- volcado de esta tabla no expone códigos vigentes.
  codigo_verificacion text,
  codigo_expira_at timestamptz,
  estado text not null default 'pendiente_revision',
  motivo_rechazo text,
  reviewed_by uuid references users (id) on delete restrict,
  reviewed_at timestamptz,
  student_id uuid references users (id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint solicitudes_estado_valido
    check (estado in ('pendiente_revision', 'aprobada', 'rechazada')),
  constraint solicitudes_cedula_format
    check (cedula is null or cedula ~ '^[0-9]{10}$')
);

comment on table solicitudes_inscripcion is
  'Solicitud de inscripción online. Existe antes que la cuenta del estudiante; student_id se llena al aprobarla.';
comment on column solicitudes_inscripcion.codigo_verificacion is
  'Hash SHA-256 (hex) del código de verificación de correo de 6 dígitos; se limpia al confirmarlo.';

-- Un solo registro por correo (la verificación de correo se reutiliza).
create unique index solicitudes_correo_unique
  on solicitudes_inscripcion (lower(correo));

-- Regla de negocio: una sola solicitud activa por cédula. Las rechazadas
-- no cuentan (se reemplazan en el mismo registro al reintentar).
create unique index solicitudes_cedula_activa_unique
  on solicitudes_inscripcion (cedula)
  where cedula is not null and estado in ('pendiente_revision', 'aprobada');

create index solicitudes_estado_idx on solicitudes_inscripcion (estado);

-- =========================================================================
-- solicitud_documentos
-- =========================================================================
create table solicitud_documentos (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references solicitudes_inscripcion (id) on delete restrict,
  tipo_documento text not null,
  storage_path text not null,
  estado text not null default 'recibido',
  motivo_rechazo text,
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,

  constraint solicitud_documentos_tipo_valido
    check (tipo_documento in ('cedula', 'papeleta_votacion', 'tipo_sangre', 'titulo_bachiller')),
  constraint solicitud_documentos_estado_valido
    check (estado in ('recibido', 'aprobado', 'rechazado')),
  -- Un documento vigente por tipo: volver a subir el mismo tipo (foto
  -- borrosa) reemplaza el anterior en vez de acumular filas.
  constraint solicitud_documentos_tipo_unico unique (solicitud_id, tipo_documento)
);

comment on column solicitud_documentos.storage_path is
  'Ruta del objeto en el bucket privado solicitudes-documentos de Supabase Storage.';

-- =========================================================================
-- RLS
-- =========================================================================
-- Estas tablas guardan cédula, correo y códigos: solo el backend (service
-- role, que ignora RLS) debe leerlas. RLS activo y SIN políticas deniega
-- todo acceso vía la API pública con la anon key.
alter table solicitudes_inscripcion enable row level security;
alter table solicitud_documentos enable row level security;

-- =========================================================================
-- Storage: bucket privado de documentos
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('solicitudes-documentos', 'solicitudes-documentos', false)
on conflict (id) do nothing;
