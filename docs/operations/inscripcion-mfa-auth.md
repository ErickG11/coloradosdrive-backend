# F21: MFA del administrador y configuración de Auth

## MFA (TOTP) del administrador

Con `ADMIN_MFA_REQUIRED=true` toda ruta `/admin/*` exige un JWT de administrador con el claim
`aal=aal2` (segundo factor TOTP verificado en la sesión); si no, responde 403 `MFA_REQUERIDA`
y el frontend redirige a `/mfa`. Por defecto es `false` (no cambia nada). El guard
(`adminMfaGuard`, montado antes de los routers `/admin/*`) no autentica: un token ausente o
inválido lo rechaza el `authenticate` de cada ruta; un rol distinto de admin, `requireRole`.
Las rutas de administrador fuera del prefijo `/admin` (por ejemplo `/practice-slots`) no se
cubren con esta bandera.

### Orden seguro de activación
1. Desplegar backend y frontend con `ADMIN_MFA_REQUIRED=false`.
2. Cada administrador entra a `/admin/seguridad` y enrola su TOTP (QR + código). Enrolar
   un segundo factor de respaldo en otro dispositivo o aplicación.
3. Comprobar que cada administrador cierra sesión, entra de nuevo y supera el desafío en `/mfa`.
4. Solo entonces poner `ADMIN_MFA_REQUIRED=true` en Railway y reiniciar.
Activar la bandera antes de enrolar deja a los administradores sin acceso al panel.

### Recuperar el acceso si se pierde el factor
Supabase no entrega códigos de recuperación y no restaura el acceso por sí mismo.
- Con un segundo factor de respaldo: entrar con él y desenrolar el perdido en `/admin/seguridad`.
- Sin respaldo, con otro administrador que sí tenga acceso: ese administrador no puede borrar
  el factor ajeno desde la aplicación; se hace desde el panel de Supabase (Authentication,
  Users, el usuario, eliminar el factor) o con la API de administración
  (`DELETE /auth/v1/admin/users/{id}/factors/{factorId}` con la service role, ejecutado por la persona
  responsable de la infraestructura y nunca desde el navegador). Después el administrador
  enrola un factor nuevo.
- Si ningún administrador puede entrar: poner temporalmente `ADMIN_MFA_REQUIRED=false` en Railway
  (reinicio), recuperar el factor como arriba, enrolar de nuevo y reactivar la bandera.
Registrar quién y cuándo hizo la recuperación; verificar la identidad de la persona fuera de banda.

### Costo
Según la documentación de Supabase (guía de MFA y "Manage Advanced MFA Phone usage"), el único
factor con cargo es el add-on de MFA por teléfono (USD 75 al mes el primer proyecto, más los
mensajes SMS). El factor TOTP (aplicación autenticadora) no figura como concepto cobrado.
Usamos solo TOTP, no se activa el add-on de teléfono. Confirmar en la página de facturación
del proyecto que no aparece "Auth MFA Phone Hours".

## Script `npm run security:check-auth`

Consulta `GET {SUPABASE_URL}/auth/v1/settings` (con `SUPABASE_ANON_KEY` si existe) y termina con
código 1 si `disable_signup` no es `true` o si `mailer_autoconfirm` no es `false`; código 2 si no
pudo consultar. No imprime claves. Ejecutarlo tras cada cambio de Auth y antes de cada despliegue.

## Pasos manuales en Supabase Auth (panel)
1. Authentication, Sign In / Providers: desactivar "Allow new users to sign up". Las cuentas
   se crean solo con la API de administración.
2. Mantener activa la confirmación de correo (no autoconfirmar).
3. Authentication, Attack Protection (o Passwords): activar "Prevent use of leaked passwords"
   (Leaked password protection) y poner la longitud mínima de contraseña en 10.
4. Authentication, Emails / Rate limits: reducir la expiración del enlace de recuperación (OTP
   expiry) a un valor corto, por ejemplo 3600 s o menos, coherente con el correo de creación de contraseña.
5. Authentication, URL Configuration: Site URL con el dominio de producción de Vercel; en
   Redirect URLs, el dominio de Vercel (y su `/crear-contrasena`) y `http://localhost:3000`.
   Ninguna otra.
6. Authentication, Multi-Factor: dejar TOTP con enrolamiento y verificación habilitados; no
   habilitar MFA por teléfono.
7. Ejecutar `npm run security:check-auth` y confirmar OK.
