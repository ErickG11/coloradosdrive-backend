# Progreso P5 (frontend) — F37, F38, F39, F40

Cerradas: F37 (38c9909), F38 (041afa4), F39 (f6413b6), F40 (6f3d3ea). En curso: ninguna. Siguiente: ninguna.

- Worktree avanzado por fast-forward a feat/inscripcion-en-linea-ui (08477a2). node_modules enlazado (symlink, sin commit).
- Build: Turbopack rechaza el symlink; se usó `next build --webpack`: compila bien; el typecheck del build falla solo por tests obsoletos de F37 (abajo) y los 2 errores preexistentes.
- F37: eliminados StudentDocuments.tsx, StudentPendingDocuments.tsx, lib/api/studentDocuments.ts. Sidebar del alumno: «Mis documentos» -> «Documentos para llevar» (misma ruta /student/documents).
- Tests existentes obsoletos (no tocados): tests/components/inscripcion/StudentDocuments.test.tsx, StudentPendingDocuments.test.tsx, y la aserción «Mis documentos» en tests/components/solicitudes-admin/SummaryNavigation.test.tsx.
- F38: el backend (F19) aún no expone en la franja los campos de que dependo; el control se muestra solo si la franja trae `identidadPresencialPendiente: true` (y `certificadoOriginalRequerido` para el 2.º casillero). Acordar con F19.
- F39: no existía «panel de seguridad»: se creó /admin/seguridad + entrada «Seguridad» en el Sidebar admin (icono nuevo en NavigationIcon). Desafío en /mfa. 403 MFA_REQUERIDA -> redirección a /mfa en lib/api/client.ts (excepto en /mfa y /admin/seguridad). LoginForm redirige a /mfa si el admin tiene factor y está en aal1.
- F40: Content-Security-Policy (solo frame-ancestors) aplicada + CSP completa en Report-Only (frame-ancestors se ignora en Report-Only). Falta F43: añadir https://challenges.cloudflare.com en script-src/frame-src/connect-src.
