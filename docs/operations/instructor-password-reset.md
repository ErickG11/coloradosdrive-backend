# Restablecimiento de contraseña de instructor

`POST /admin/instructores/:id/restablecer-password` requiere rol admin. Solo acepta
un instructor activo. Devuelve 204 sin cuerpo ni contraseña; 404 si el id no
corresponde a un instructor y 409 si está inactivo.

El servidor genera una contraseña temporal nueva, la establece en Supabase Auth,
marca `users.debe_cambiar_password = true` y envía un único correo con la plantilla
de credenciales, identificándolo como restablecimiento solicitado por el admin.
Un reintento genera otra contraseña: solo la última establecida en Auth será válida.

- Si falla Auth, no se actualiza `users` ni se envía correo (502).
- Si se pierde la respuesta de Auth, el resultado puede ser incierto: se
  devuelve 503 sin correo y el admin debe reintentar para crear otra clave.
- Si falla la actualización del indicador después de cambiar Auth, no se envía
  correo y se devuelve 503 para reconciliación o reintento. Auth y `public.users`
  no comparten una transacción; la contraseña anterior ya puede ser inválida.
- Si falla el correo, la clave y el indicador ya se actualizaron. Se devuelve
  502 con instrucción de reintentar; el reintento sustituye la clave que no
  llegó. No se devuelve ni se registra la clave temporal en logs.
- Tras un envío exitoso, el log contiene solo `adminId`, `instructorId` y `fecha`.

La API administrativa instalada de Supabase permite `signOut(jwt)`, pero requiere
un JWT de la sesión del instructor, no solo su id. Esta ruta no dispone de ese
JWT y no revoca explícitamente las sesiones. El middleware consulta el indicador
en la base por petición y bloquea las demás rutas del instructor hasta cambiar
la contraseña; un JWT ya emitido puede seguir vigente hasta su expiración.
