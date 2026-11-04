# F44-b · correo y auditoría de producción

Nodemailer actualizado de9.1.1 a10.3.1, fijado en package.json y lockfile.
Se aplicaron además correcciones compatibles del lockfile (sin --force) para quitar
avisos altos/críticos de body-parser, multer y proxy-addr. No se actualizó node-cron
con salto mayor; los avisos moderados restantes no se ocultan ni desactivan la auditoría.
El paso de GitHub CI npm audit --omit=dev --audit-level=high ahora es bloqueante.

## Avisos y alcanzabilidad

Se revisaron los avisos publicados de addressparser (incluidos GHSA-v53p-9fqp-m79j,
GHSA-prgh-xp8r-p3m5 y GHSA-85x2-q946-cp5h) y el changelog instalado. Referencias:
[avisos oficiales](https://github.com/nodemailer/nodemailer/security/advisories),
[cambio mayor10](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.0),
[versión corregida](https://github.com/nodemailer/nodemailer/releases/tag/v10.3.1).

La inscripción normaliza y limita correo a254 caracteres, rechaza comentarios,
comillas, corchetes y arrays; el destinatario llega a sendMail desde el expediente.
Por ese camino no se puede inyectar la forma RFC5322 de los avisos revisados.
Se usan cuerpos/adjuntos construidos por el servidor y no se permite al postulante
controlar transport.name, envelope.size, DKIM o un raw MIME. El host SMTP es fijo;
no hay transportes multiinquilino configurables que mezclen servername.
Otros flujos reutilizan EmailService: se actualiza la dependencia compartida para
no depender únicamente del validador de inscripción. La ausencia de un disparador
alcanzable aquí se basa en revisión estática; no se ejecutó un exploit ni una suite.

## Compatibilidad revisada

-10 exige Node>=20: este repositorio/CI usa22. Conserva builds CommonJS y la
distribución de tipos de @types/nodemailer. Se conserva el import MailComposer
desde nodemailer/lib/mail-composer y createTransport con opciones de objeto.

- SMTP mantiene host/puerto/TLS, autenticación y timeouts existentes; no usa pool
  ni opciones nuevas otp. Los cambios de errores no se propagan con datos del proveedor.
- gmail_api conserva compile/build, keepBcc, MIME base64url, caché/reintento401 y
  fetch con timeout. La ruta lib/mail-composer conserva su entrada CommonJS.
- console adapta el nuevo tipo de destinatario (listas anidadas) con recorrido acotado
  sin recursión. No construye SMTP ni MailComposer; mantiene salida local y las guardas
  production/Railway. No se tocó .env, secretos ni las plantillas de correo.

Validación: typecheck global de fuente, lint de config/correo y build final backend.
Auditoría de producción con exit0 (sin altas/críticas); las cifras finales y sus
limitaciones se anotan en el progreso. No se hicieron pruebas de envío por la
restricción expresa del usuario; verificar smtp/gmail_api/console en la fase final.
