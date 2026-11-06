# ADR 018 — MFA del administrador (TOTP)

Estado: aceptado. Activación por bandera.

## Contexto

El administrador aprueba inscripciones, ve datos personales y puede eliminar expedientes. Una contraseña robada concentraría todo ese poder.

## Decisión

- TOTP de Supabase Auth (aplicación autenticadora). Según la documentación de Supabase el TOTP está incluido en todos los planes (el MFA por teléfono es el que tiene costo); confirmarlo en el panel antes de activar.
- Backend: con `ADMIN_MFA_REQUIRED=true`, todo `/admin/*` exige el claim `aal=aal2` y responde 403 `MFA_REQUERIDA` si falta. Por defecto es `false` para no bloquear al administrador actual.
- Orden seguro de activación: 1) el administrador enrola su factor en el panel de seguridad y lo verifica; 2) se comprueba un inicio de sesión con desafío; 3) recién entonces se activa la bandera en el entorno. Activarla antes deja al administrador fuera.
- Recuperación si se pierde el factor: otro acceso de servicio (persona con acceso al panel de Supabase) elimina el factor del usuario desde Authentication, o se desactiva temporalmente la bandera y el administrador vuelve a enrolar. Debe conservarse al menos un segundo administrador o un procedimiento con el responsable de la plataforma.

## Consecuencias

El frontend debe manejar el enrolamiento, el desafío tras el login y el 403 `MFA_REQUERIDA`. Los instructores y alumnos no quedan cubiertos por esta decisión.
