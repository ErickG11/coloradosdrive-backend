# Progreso P3 (frontend)
- F32 hecha: app/crear-contrasena/{layout,page}.tsx + components/inscripcion/CrearContrasena.tsx. Typecheck/lint ok (solo 2 errores preexistentes).
- F33 hecha sin cambios de código: components/landing/CourseCard.tsx ya enlaza a /inscripcion?courseId=<id> (encodeURIComponent); app/inscripcion/page.tsx lo lee y lo pasa a InscripcionFlow (initialCourseId). whatsappHref ya es exportada y reutilizable en lib/content/landing.ts (la usa F32). Nota: lib/content/landing.ts tiene href "/inscripcion" sin courseId en los cursos del contenido estático (no se usa para el CTA de CourseCard).
- Build: ok con `next build --webpack` (Turbopack rechaza el symlink de node_modules del worktree).
- Notas: la rama del worktree se avanzó (ff) a feat/inscripcion-en-linea-ui antes de empezar. Tras éxito se cierra la sesión local y se lleva a /login. /crear-contrasena no está bajo prefijos protegidos del proxy. Pendiente de otros: CSP/headers en F40.
- Siguiente: ninguna.
