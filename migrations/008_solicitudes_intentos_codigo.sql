-- 008_solicitudes_intentos_codigo.sql
-- Contador de intentos fallidos del código de verificación de correo, para
-- limitar fuerza bruta sobre un código de 6 dígitos independientemente del
-- rate limit por IP (un atacante con varias IPs lo rodea).

alter table solicitudes_inscripcion
  add column intentos_codigo integer not null default 0;

comment on column solicitudes_inscripcion.intentos_codigo is
  'Intentos fallidos consecutivos contra codigo_verificacion. Al llegar a 5, el código se invalida (ver SolicitudService.confirmarCodigo) y hay que pedir uno nuevo. Se reinicia a 0 cada vez que se genera un código nuevo.';
