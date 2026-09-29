-- 016_users_datos_estudiante_ampliados.sql
-- Amplía los datos que se capturan de un estudiante al matricular. Las 5
-- columnas son nullable: no bloquean nada existente ni requieren backfill
-- (tabla con pocos registros reales, y los usuarios ya matriculados
-- simplemente quedan con estos campos en NULL hasta que se actualicen).

begin;

alter table users
  add column fecha_nacimiento date,
  add column tipo_sangre text,
  add column genero text,
  -- Sin default a nivel de base de datos: 'Ecuatoriana' es solo una
  -- sugerencia de UI en el formulario de matrícula, no una regla de
  -- negocio que deba imponerse a cada fila nueva.
  add column ciudadania text,
  add column direccion text;

comment on column users.fecha_nacimiento is
  'Fecha de nacimiento del usuario. Opcional; sin validación de edad mínima a nivel de base de datos.';
comment on column users.tipo_sangre is
  'Tipo de sangre del usuario (ej. "O+"). Texto libre, sin catálogo cerrado.';
comment on column users.genero is
  'Género del usuario, texto libre (sin catálogo cerrado a nivel de base de datos).';
comment on column users.ciudadania is
  'Ciudadanía del usuario, texto libre. "Ecuatoriana" es la sugerencia por defecto en el formulario de matrícula, no un default de columna.';
comment on column users.direccion is
  'Dirección de domicilio del usuario, texto libre.';

commit;
