# Progreso B3 (F22, F24, F42)

Base: f48af38 (F13). Sin migraciones (057-059 no usadas).

## F22 cerrada
- Commit: `feat(seguridad): endurece cabeceras, logs, timeouts, búsqueda del admin e inventario de rutas`.
- Helmet explícito (CSP default-src none, frame-ancestors none, Referrer-Policy no-referrer); CORS con
  `new URL(FRONTEND_URL).origin`; `Cache-Control: no-store` global; JSON 16 kb en /solicitudes,
  /public/inscripcion, /admin/solicitudes, /admin/inscripciones (errores 413 CUERPO_DEMASIADO_GRANDE y
  400 JSON_INVALIDO); timeouts keepAlive 65 s / headers 70 s / request 60 s (`config/serverHardening.ts`).
- Logs: `utils/safeLog.ts` (solo nombre/código/estado del error). Reemplazados 7 `console.error(err)` que
  podían exponer destinatarios o cuerpos. Quedan JSON con ids técnicos (sin PII).
- Búsqueda `q`: `utils/postgrestSearch.ts` (escapa %, _, \, entrecomilla, quita `*`, controles y bidi).
  Aplicado en solicitud.service.listarParaAdmin e instructor.service.list. Si B1/B2 reescriben esas
  consultas deben seguir usando `buildIlikeOr`. cohort.service `.or` usa solo timestamps internos.
- Inventario: `npm run security:routes` (src/scripts/securityRoutes.ts, utils/routeInventory.ts,
  utils/routeGuards.ts, config/publicRoutes.ts). Guards marcados por registro (authenticate,
  requireRole, authenticateSolicitud; asyncHandler propaga la marca). 103 rutas: 97 protegidas, 6 públicas
  en lista blanca, 0 sin protección. Tras unir ramas: ejecutar de nuevo; toda ruta nueva sin guard falla
  hasta añadirla a `PUBLIC_ROUTE_ALLOWLIST` con razón. Cualquier guard nuevo debe llamar `markGuard`.
- Observación: `requireRole` sin `authenticate` cuenta como protegida (devuelve 401 sin req.user).
- Código de otros agentes: aún no integrado; nada que anotar.


## F24 cerrada
- Commit 5cb13b6: gitleaks.yml (historial completo), dependabot semanal (npm + actions), paso
  `npm audit --omit=dev --audit-level=high` en ci.yml (continue-on-error por ahora) y Jenkinsfile; ADRs
  015-019 con sufijo b3 en docs/adr. Renumerar si F41 usa otros números.
- Auditoría: 8 vulnerabilidades de producción (1 crítica proxy-addr; altas body-parser, multer, nodemailer).
  `npm audit fix --package-lock-only` (probado en copia) deja solo nodemailer <=10.1.3 (alta; el arreglo
  es un salto mayor a 10.x). No toqué package-lock. Pendiente del responsable: aplicar el fix de lockfile
  y quitar continue-on-error.
- Historial (últimos 200 commits; patrones JWT, claves privadas, AWS, tokens de hosting, sbp_/sb_, URLs de BD,
  asignaciones SECRET/TOKEN/PASSWORD, Google client, Slack): sin credenciales reales. Solo placeholders de
  pruebas/docs y claves de prueba públicas de Cloudflare. Ningún .env/.pem/.key versionado.
  Direcciones @gmail.com solo como datos de ejemplo en pruebas/SQL.

## F42 cerrada
- Commit: feat(correo): añade proveedor gmail_api por HTTPS con renovación de token.
- src/config/gmailApiMailer.ts (fetch inyectable, caché con margen 60 s, un reintento ante 401,
  invalid_grant -> GmailApiError GMAIL_INVALID_GRANT, valida scope si Google lo informa, timeout 15 s,
  Bcc conservado). env.ts: EMAIL_PROVIDER acepta gmail_api (exige EMAIL_USER y GMAIL_*; no exige
  EMAIL_APP_PASSWORD); el mensaje de error conserva el prefijo anterior. smtp/console intactos.
- Typecheck, lint y build ok. Migraciones 057-059 no usadas.
