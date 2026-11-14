# ColoradosDrive · Traspaso del backend

Fecha del documento: 7 de noviembre de 2026. Defensa de titulación: **14 de noviembre de 2026**.
Este documento es para quien continúa el trabajo sin conocer el proyecto. Léelo completo antes de tocar nada.
No contiene secretos: los valores reales se piden al responsable del proyecto por un canal seguro.

## 1. Qué es y en qué estado está

ColoradosDrive es una plataforma de gestión para una escuela de conducción (proyecto de titulación, UDLA).
Dos repositorios públicos bajo ErickG11:

- Backend (este): Express + TypeScript + Supabase (Postgres, Auth, Storage). Puerto local **3000**.
- Frontend: Next.js 16 (`coloradosdrive-frontend`). Puerto local **3001**.

Estado actualizado tras fusionar a `main` los PR #45, #44 y #54 (7 de noviembre de 2026):

- El flujo de **inscripción en línea** (solicitud pública, revisión del admin, aprobación, reserva de horario y pago) está **fusionado en `main`** en backend y frontend y probado a mano con el modo de correo en consola.
- Las migraciones **001 a 063 están todas aplicadas** en la base compartida.
- **El CI de `main` pasó en verde tras los merges**, incluidos los dos pasos de PostgreSQL aislado (`test:students-db` y `test:practice-attendance-db`). CircleCI aparece en rojo porque no tiene configuración: se ignora. Hay 26 pruebas saltadas con `TODO(F23)`, listadas en «Deuda de pruebas».
- Siguiente paso: despliegue en Railway (backend) y Vercel (frontend) **desde `main`** (ver `docs/DESPLIEGUE.md`). Faltan además correo por API de Gmail con credenciales reales, Turnstile (F43), certificación de Kushki y un recorrido de ensayo. Ver sección 7.

## 2. Mapa de ramas y PR

| Rama | PR | Estado |
| --- | --- | --- |
| `main` | | Línea estable; incluye todo lo siguiente. No se empuja a mano. |
| `feat/inscripcion-en-linea` | #45 | **Fusionado en `main`**. Flujo completo de inscripción en línea. Ya no hace falta; se conserva, no se borra. |
| `fix/matricula-validaciones-backend` | #44 | **Fusionado en `main`**. Validaciones de matrícula manual (fechas de nacimiento, mensajes y códigos). Se conserva. |
| `fix/ci-main-pruebas-matricula-manual` | #54 | **Fusionado en `main`**. Corrige una prueba de validaciones de matrícula manual. Se conserva. |
| `worktree-agent-*`, `feature/*` antiguas | no se publican | Restos de trabajo local. No usar como base. |

Reglas de partida:

- Todo trabajo nuevo (inscripción o no) **parte de `main`**: `git checkout main && git pull`, y crear una rama nueva.
- Ninguna de las ramas fusionadas debe usarse como base ni borrarse sin autorización del responsable.
- `feat/instructores-agenda-simple` (frontend) pertenece a otra persona: no la toques.

## 3. Cómo correr en local

```bash
npm install
cp .env.example .env     # luego pide los valores reales (Supabase) al responsable
npm run dev              # backend en http://localhost:3000
```

El frontend corre aparte en el puerto 3001 (`npm run dev` en su repositorio) y `FRONTEND_URL` del backend debe apuntar a él.
Otros comandos: `npm run lint`, `npm test` (Jest), `npm run build`, `npm run security:routes`, `npm run security:check-auth`, `npm run check:inscripcion-migrations` (arnés en PostgreSQL embebido, no toca Supabase).

### Variables de entorno (solo nombres; los valores reales nunca se suben)

Base y Supabase

- `NODE_ENV`: development, test o production.
- `PORT`: puerto de Express (3000).
- `FRONTEND_URL`: origen permitido por CORS (nunca `*`).
- `DISABLE_CRON`: `true` en local para apagar los crons.
- `SUPABASE_URL`: URL del proyecto.
- `SUPABASE_SERVICE_ROLE_KEY`: clave privilegiada, solo backend.
- `SUPABASE_ANON_KEY`: clave pública.

Correo

- `EMAIL_PROVIDER`: `console` (local, imprime los correos en la terminal), `smtp` o `gmail_api`. `console` está prohibido en producción.
- `EMAIL_USER`, `EMAIL_APP_PASSWORD`: remitente y contraseña de aplicación para SMTP.
- `PRIVACY_CONTACT_EMAIL`: contacto de derechos del aviso de privacidad.
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`: OAuth para el proveedor `gmail_api` (alcance `gmail.send`).

Solicitudes y seguridad

- `SOLICITUD_TOKEN_SECRET`: firma del token temporal del flujo (mínimo 32 caracteres aleatorios).
- `ENROLLMENT_RATE_HMAC_SECRET`: secreto opcional para los límites por correo/IP.
- `ADMIN_MFA_REQUIRED`: exige segundo factor al admin (activar solo después de enrolar a cada admin).
- `CAPTCHA_PROVIDER`: `off` (solo desarrollo) o `turnstile`; `TURNSTILE_SECRET_KEY` es la clave del servidor.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: clave pública del widget (se documenta aquí por estar en `.env.example`).
- `TRUST_PROXY_HOPS`: proxies de confianza (0 local, 1 en Railway).
- `PRIVACY_NOTICE_VERSION`, `TERMS_VERSION`, `TERMS_REFUND_TEXT`: versiones y texto de reembolso (borrador legal).
- `RECENT_GRAD_MONTHS`: umbral de graduación reciente (12).
- `ENROLLMENT_CODES_DAILY_CAP`, `ENROLLMENT_NEW_REQUESTS_DAILY_CAP`, `ENROLLMENT_UPLOADS_DAILY_CAP`, `ENROLLMENT_UPLOADS_PER_IP_DAILY_CAP`: topes diarios globales.
- `ENROLLMENT_CODES_PER_IP_HOUR`, `ENROLLMENT_CODES_PER_EMAIL_DAILY_CAP`, `ENROLLMENT_FAILED_CODES_PER_EMAIL_DAILY_CAP`, `ENROLLMENT_CODE_COOLDOWN_SECONDS`: límites por IP y por correo.
- `APPROVAL_CLAIM_TTL_MINUTES`: recuperación de aprobaciones interrumpidas (10).

Alumno aprobado y pagos

- `RESERVA_TTL_MINUTES`, `RESERVA_MAX_EXTENSIONES`, `RESERVA_EXTENSION_MINUTES`, `RESERVA_MAX_POR_DIA`, `PAGO_GRACIA_MINUTES`: vencimiento y límites de la reserva.
- `COHORT_MARGIN_DAYS`: margen entre la última práctica y el fin del curso.
- `PAYMENT_PROVIDER`: `simulado`, `manual` o `kushki`.
- `PAYMENT_SURCHARGE_CENTS`: recargo en centavos.
- `KUSHKI_ENVIRONMENT`, `KUSHKI_PUBLIC_KEY`, `KUSHKI_PRIVATE_KEY`, `KUSHKI_WEBHOOK_SECRET`, `KUSHKI_MERCHANT_ID`: solo si se usa Kushki.

**Valores seguros para probar en local:** `EMAIL_PROVIDER=console`, `CAPTCHA_PROVIDER=off`, `DISABLE_CRON=true`, `PAYMENT_PROVIDER=simulado`, `ADMIN_MFA_REQUIRED=false`. Con ellos no se envía correo real ni se cobra nada.
En `console`, los códigos y enlaces aparecen en la terminal del backend.

## 4. Base de datos

- Hay **un único proyecto Supabase compartido** por el desarrollo local y la futura producción. Cualquier SQL o prueba contra él afecta datos reales: ve con mucho cuidado y avisa antes.
- Migraciones numeradas **001 a 063 en `migrations/`, todas aplicadas**. No se reaplican ni se reasignan números (057 es inmutable). 064 en adelante está libre.
- Cada migración reciente tiene su carpeta de scripts en `docs/operations/`: `inscripcion-NNN-preflight.sql`, `inscripcion-NNN-verificacion.sql` e `inscripcion-NNN-rollback.sql` (y un `.md` con el detalle). Orden y dependencias: `docs/operations/inscripcion-orden-migraciones.md`.

Procedimiento seguro para aplicar una migración nueva:

1. Ejecuta el **preflight** (comprueba que la base está en el estado esperado; si falla, no continúes).
2. Aplica la migración. Copia el SQL **desde el editor de código**, no desde la terminal (la terminal puede romper saltos de línea y comillas).
3. Ejecuta la **verificación** (termina en ROLLBACK, no deja cambios) y anota la hora. Si falla, usa el rollback.
4. No reaplicar una migración ya aplicada.

Detalle de hashes: las verificaciones de 060 a 062 comparan funciones con `md5(replace(prosrc, chr(13), ''))`, es decir, quitan el retorno de carro antes de comparar, porque las migraciones aplicadas desde Windows guardan saltos CRLF (ver `inscripcion-060.md`). Si la comparación sigue fallando, detén la aplicación.

## 5. Resumen del flujo de inscripción

Detalle completo: `docs/operations/inscripcion-flujo-final.md` y `inscripcion-alumno-runbook.md`.

- **Estados de la solicitud:** `borrador` → `enviada` → `devuelta` (el admin pide correcciones; el postulante reenvía) → `aprobada` o `rechazada`. Un borrador se purga a los 7 días, una devuelta vence a los 15 (pasa a rechazada con motivo VENCIDA), una rechazada se purga a los 30.
- **Pasos del postulante:** requisitos, correo, código, consentimiento y términos versionados, datos, estudios (con certificado si el nivel lo exige), revisión y envío.
- **Verificaciones del admin** (append-only): identidad (por ejemplo portal del Registro Civil) y estudios (por ejemplo código QR del certificado). Para aprobar, ambas deben ser vigentes y posteriores a los datos.
- **Aprobación sin contraseña:** se crea la cuenta y se envía un enlace de **un solo uso** (`/crear-contrasena`) para que el alumno defina su contraseña (mínimo 10). La aprobación es en dos pasos con recuperación automática de reclamos interrumpidos.
- **Etapas de la matrícula:** `por_agendar` (aprobado, sin horario) → `reservado` (horario y cupo retenidos) → `activa` (pago confirmado; se crean las prácticas definitivas).
- **Reserva con vencimiento:** 15 min, una ampliación de 10 min, máximo 3 reservas por día, una sola gracia de pago de 10 min. La autoridad del tiempo es el reloj de SQL.
- **Cohorte e instructor automáticos:** el servidor elige la cohorte (misma de curso, matrícula abierta y cupo) y arma un plan de bloques de una hora desde la hora de inicio elegida; el instructor se asigna por franja y se muestra solo tras pagar. No se consideran feriados.
- **Pagos:** `simulado` (solo fuera de producción), `manual` (efectivo registrado por el admin, con referencia textual) y `kushki` (tarjeta con Hosted Fields; **implementado pero sin certificar**). El importe lo calcula SQL; IVA = 0 es una constante pendiente de definición fiscal.
- **Retención de datos:** borradores 7 días, devueltas 15, rechazadas 30 (`SOLICITUD_RETENCION_DIAS`), certificados verificados se borran a los 30 días de verificados, huérfanos de Storage a 1 día. Zona horaria America/Guayaquil.

## 6. Seguridad y reglas para contribuir

- Nunca subas `.env`, claves, tokens ni credenciales. Si algo se sube por error, avisa de inmediato para rotarlo.
- Commits en español, con prefijo convencional en inglés (`feat`, `fix`, `docs`, `test`, `chore`) y la última línea `Tarea: Fxx · Historia: ...`.
- **Sin `Co-Authored-By`** ni marcas de herramientas en commits o PR (proyecto de titulación: la autoría es del estudiante).
- No uses `push --force`, rebase de ramas publicadas ni `--no-verify`. No empujes a `main`.
- No fusiones a `main` con el CI en rojo. Los PR se abren en borrador.
- No uses datos personales reales en pruebas ni documentación: solo ejemplos ficticios.

## 7. Pendientes por prioridad para la defensa del 14

1. **Pruebas:** el CI de `main` está en verde. Queda reescribir las 26 pruebas saltadas (sección «Deuda de pruebas»). En local, `npm run lint` también recorre `.claude/worktrees/`: usa `--ignore-pattern ".claude/**"`. La deuda de pruebas de la inscripción está además en `docs/operations/inscripcion-pruebas-pendientes*.md`.
2. **Despliegue** (ver `docs/DESPLIEGUE.md`): backend en Railway desde `main` (`TRUST_PROXY_HOPS=1`, `NODE_ENV=production`) y frontend en Vercel; configurar Supabase Auth (registros públicos off, contraseña mínima 10, Site URL y redirects) y verificar con `npm run security:check-auth`.
3. **Correo por API de Gmail:** el proveedor `gmail_api` existe; faltan credenciales OAuth y variables en el entorno.
4. **Turnstile (F43):** el backend ya valida; falta el widget en el frontend y las claves reales. Hasta entonces los límites por correo/IP y los topes son la única barrera contra bots.
5. **Kushki:** certificación con el proveedor y webhook con HTTPS público (`POST /webhooks/kushki`). Ver `inscripcion-kushki-verificacion.md`.
6. **Recorrido de ensayo** completo con el guion de `inscripcion-flujo-final.md` (correo en consola).
7. Enrolar el TOTP de cada admin y solo entonces `ADMIN_MFA_REQUIRED=true`.

Trabajo futuro: contenido descargable de profesores, exámenes asignados por alumno, cuotas, IVA, feriados.

## 8. Preguntas de negocio abiertas (para la escuela)

- ¿Se exigirán los **documentos originales físicos** y en qué momento se revisan?
- Postulantes **de 16 a 17 años**: ¿se aceptan y con qué requisitos del representante?
- **Política de reembolsos** y qué hacer con un pago recibido que no puede activar la matrícula.
- **Vencimiento de la reserva** (hoy 15 min) y gracia de pago.
- **Requisitos del Tipo A** (cursos profesionales).
- **Textos legales** (aviso de privacidad y términos) están en borrador, pendientes de revisión legal.
- **URL del Registro Civil** para la verificación de identidad (hoy es la página institucional como valor provisional).

## 9. Datos de prueba en la base

La base compartida contiene datos ficticios de ensayo: solicitudes en distintos estados, alumnos y matrículas de prueba, cohortes y franjas de práctica de ensayo y pagos simulados. No hay datos personales reales conocidos. No borres ni conviertas la matrícula antigua de ensayo sin coordinar.

## Dónde leer más

`docs/operations/inscripcion-flujo-final.md`, `inscripcion-orden-migraciones.md`, `inscripcion-alumno-runbook.md`, `inscripcion-pagos-proveedores.md`, `inscripcion-kushki-verificacion.md`, `inscripcion-brief.md`, y los ADR 014 a 019 en `docs/adr/`.

## Deuda de pruebas

`tsc`, lint, `npm test` y build pasan; hay 26 pruebas saltadas. Los pasos del CI `npm run test:students-db` y `npm run test:practice-attendance-db` requieren PostgreSQL aislado: no se pueden ejecutar en local, pero **están en verde en el CI de `main`**.

Pruebas saltadas, todas con `TODO(F23)` (flujo antiguo retirado con el rediseño; hay que reescribirlas contra el contrato vigente):

| Archivo | Saltadas | Motivo |
| --- | --- | --- |
| `tests/integration/solicitudesAdmin.test.ts` (`describe.skip` ×2) | 25 | La revisión por documento (`PATCH /admin/solicitudes/:id/documentos/:docId`) y la decisión por `PATCH /admin/solicitudes/:id` se retiraron. Reescribir contra `POST /admin/solicitudes/:id/verificaciones` y `POST /admin/solicitudes/:id/decision`. |
| `tests/integration/consoleEmail.test.ts` | 1 | Aprobar imprimía la contraseña temporal; ahora la aprobación es en dos pasos por RPC y envía un enlace de un solo uso. |

Cambios de método de esta ronda: las suites que usan alumnos se apoyan en `tests/helpers/authMocks.ts` (el middleware consulta `users` y `enrollments` por petición); se retiraron las pruebas de `solicitudDeletion`, `studentDocuments` y `studentPendingDocuments` (servicios y rutas eliminados).

## Despliegue

Guía de despliegue en Railway y Vercel (modo demostración incluido): [`docs/DESPLIEGUE.md`](DESPLIEGUE.md).

## Dependabot

Dependabot abre PR automáticos de dependencias. Antes de la defensa **no se fusionan saltos de versión mayor** (por ejemplo TypeScript 7 o React). Los PR con el CI en rojo no se tocan. Solo se aceptan actualizaciones menores o de parche con el CI en verde y revisadas por el responsable.

---

## Estado al 13/11/2026

Sección escrita solo a partir de `git log`, los archivos de migración y las indicaciones del responsable. Rama principal de trabajo: `feat/cohortes-reglas-inscripcion`, creada a partir de `main` (`origin/main` es ancestro de la rama; no hay commits de `main` que le falten). Defensa de titulación: 14 de noviembre de 2026.

### Advertencias antes de continuar

- **No fusionar a `main` todavía.** Muchas pruebas automáticas están desactualizadas por los cambios de esta rama (hay fallos conocidos) y la integración continua saldrá en rojo. Primero hay que actualizarlas. Falta además la prueba manual descrita en «Pendientes».
- **Base de datos única y compartida** (Supabase, ref `qvyptmjmvrpewjynnnxs`): cualquier prueba local escribe en ella. Usa siempre alumnos de prueba y nunca datos reales.
- Las migraciones las aplica el dueño a mano en el SQL Editor (preflight, migración, verificación y, si hace falta, rollback). No se aplican desde el repositorio. La **026** y otras se aplicaron de esa forma.
- **El borrador `064_precio_por_tipo_curso.sql` (con sus scripts `precio-curso-064-*.sql`) NO se aplica.** Está en el repositorio solo como borrador y el manifiesto de despliegue lo excluye.

### Migraciones 085 a 094

| Migración | Tema | Estado en la base real |
| --- | --- | --- |
| 085 | Alumnos sin cohorte y orden por espera | Aplicada |
| 086 | Plan nuevo de diez horas | Aplicada |
| 087 | Acceso al pagar y gestión individual de cohortes | Aplicada |
| 088 | Contrato de asistencia (`practice_plan`) | Aplicada |
| 089 | Asistencia por bloques | Aplicada |
| 090 | Reposición por bloques | Aplicada |
| 091 | Avisos por bloque y compatibilidad | Aplicada |
| 092 | Aviso de inasistencia en un solo paso | Aplicada |
| 093 | Política de Realtime de avisos (`notifications_broadcast_v14`) | **No confirmada como aplicada.** Es idempotente y su efecto ya está en la base |
| 094 | Materiales obligatorios previos al examen | Aplicada |

Cada una tiene preflight, verificación (termina en ROLLBACK) y rollback en `docs/operations/inscripcion-NNN-*.sql`, y está en `docs/operations/cohortes-manifiesto-despliegue.json`.

### Cómo arrancar

- Requisito: **Node 22**.
- Backend (puerto **3000**): `DISABLE_CRON=false npm run dev`. Con `EMAIL_PROVIDER=console` los correos se imprimen en la terminal.
- Frontend (puerto **3001**): `npm run dev`; su `NEXT_PUBLIC_API_URL` debe apuntar al backend.

### Variables de entorno (solo nombres; los valores se piden a Erick por un canal privado, nunca por GitHub)

Backend: `NODE_ENV`, `DISABLE_CRON`, `PORT`, `FRONTEND_URL`, `CORS_ORIGINS`, `DEMO_MODE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `EMAIL_PROVIDER`, `EMAIL_USER`, `EMAIL_APP_PASSWORD`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `SOLICITUD_TOKEN_SECRET`, `ENROLLMENT_RATE_HMAC_SECRET`, `ADMIN_MFA_REQUIRED`, `CAPTCHA_PROVIDER`, `TURNSTILE_SECRET_KEY`, `PAYMENT_PROVIDER`, `KUSHKI_PUBLIC_KEY`, `KUSHKI_PRIVATE_KEY`, `KUSHKI_WEBHOOK_SECRET`, `KUSHKI_MERCHANT_ID` y el resto de las que lista `.env.example`.
Frontend: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` (y `NEXT_PUBLIC_TURNSTILE_SITE_KEY` si se activa el captcha).

### Etiquetas de respaldo y cómo volver

Hay etiquetas `pre-cNN` (por ejemplo `pre-c17`, `pre-c20`, `pre-c25`, `pre-c27`; en el frontend también `pre-c15-horarios`, `pre-c19`, `pre-c22`, `pre-c23`, `pre-c24`) que marcan el estado justo antes de cada tarea, y `respaldo-antes-de-subir-2026-11-13` con el estado al entregar. Para volver a una **sin perder trabajo**: `git checkout -b rescate <etiqueta>`. Nunca uses `reset --hard` sobre trabajo ajeno.

### Pendientes

- Ensayo de concurrencia con dos sesiones reales (dos alumnos tomando el mismo cupo; PGlite no da dos conexiones).
- Prueba manual en navegador de C25, C26 y C27.
- Revisar las pantallas de C11 y C12.
- «1 Issue» del indicador de desarrollo de Next en `/admin/content` (no se pudo reproducir sin servidor).
- Avisos de «Contenido actualizado» con la fecha en formato técnico (se generan en `migrations/066a_contenido_api_funciones.sql`).
- Eliminar cohortes o alumnos que tienen pagos (decisión de negocio).
- Vista de Pagos del administrador.
- Mover la hora de los días restantes de un alumno que ya empezó (operación B: solo administrador, todo o nada; aún no construida).

### Tareas «Tarea: Cxx» en este repositorio (`git log --grep`)

- **C02** — Documentos, fechas y cambio de cohorte desde la ficha; migración 084 y guardas MD5 de 082 y 083.
- **C06** — «Sin cohorte» incluye toda matrícula pendiente y se ordena por espera (085); error real de base en el aviso de espera.
- **C08** — Planes nuevos de diez horas (086).
- **C09** — Acceso desde el pago y gestión individual de cohortes (087).
- **C14** — Asistencia por bloques: contrato, bloques, reposición y avisos (088–091), ajuste un bloque por fecha por matrícula y documentación (ADR 024).
- **C17** — Aviso de inasistencia en un solo paso, mismo día y mismo instructor (092).
- **C18** — Política de Realtime de avisos sin leer `users` (093).
- **C20** — Materiales obligatorios previos para rendir un examen; abrir completa el material (094).
- **C25** (partes B, C y D) — Cambio de horario del administrador: destino fijo a la cohorte actual, instructores por hora en solo lectura y aviso a instructores afectados.
- **C27** — Las horas que el cambio de plan deja de usar vuelven a «disponible».
