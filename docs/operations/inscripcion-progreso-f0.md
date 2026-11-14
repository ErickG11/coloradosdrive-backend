
## F25 · cliente API tipado, tipos y errores (Historia H1) — CERRADA
- Commit (worktree frontend): feat(inscripcion): cliente API tipado y mensajes de error en español.
- Archivos: types/inscripcion.ts, lib/api/inscripcion.ts (token solo en memoria vía sesionSolicitud;
  fetch público propio sin sesión Supabase; multipart `archivo`+`subtipo`; admin/alumno/instructor con `api`),
  lib/api/inscripcionErrors.ts (mapa código→mensaje, requiereVerificarCorreoDeNuevo, sugiereWhatsapp,
  InscripcionApiError con `faltantes`). No se tocó client.ts/errors.ts compartidos.
- Verificación: tsc sin errores nuevos (2 preexistentes del worktree: LayoutProps y login-fondo.png);
  eslint ok; build ok con --webpack y variables NEXT_PUBLIC_* ficticias por línea de comandos
  (el worktree no tiene node_modules propio: turbopack no resuelve next).
- Supuestos: los backend de admin (detalle, verificaciones, decision, certificado/url, estado-inscripcion,
  identidad-presencial) aún no existen; sus tipos siguen el brief y pueden ajustarse en F34-F38.
  confirmar-codigo hoy devuelve {solicitudId, token} sin scope; progreso trae puedeEditar.
- Siguiente: ninguna (F0 solo tiene F25).
