# ColoradosDrive · Traspaso del backend

Fecha del documento: 7 de noviembre de 2026. Defensa de titulación: **14 de noviembre de 2026**.
Este documento es para quien continúa el trabajo sin conocer el proyecto. Léelo completo antes de tocar nada.
No contiene secretos: los valores reales se piden al responsable del proyecto por un canal seguro.

## 1. Qué es y en qué estado está

ColoradosDrive es una plataforma de gestión para una escuela de conducción (proyecto de titulación, UDLA).
Dos repositorios públicos bajo ErickG11:

- Backend (este): Express + TypeScript + Supabase (Postgres, Auth, Storage). Puerto local **3000**.
- Frontend: Next.js 16 (`coloradosdrive-frontend`). Puerto local **3001**.

Estado al 7 de noviembre de 2026:

- El flujo de **inscripción en línea** (solicitud pública, revisión del admin, aprobación, reserva de horario y pago) está implementado en backend y frontend y probado a mano con el modo de correo en consola.
- Las migraciones **001 a 063 están todas aplicadas** en la base compartida.
- **El CI de GitHub está en rojo** por pruebas heredadas que no compilan y otras sin arreglar. No se debe fusionar nada a `main` hasta ponerlo en verde.
- Faltan: despliegue, correo por API de Gmail con credenciales reales, Turnstile (F43), certificación de Kushki y un recorrido de ensayo. Ver sección 7.

## 2. Mapa de ramas y PR

| Rama | PR | Qué contiene |
| --- | --- | --- |
| `main` | | Línea estable. No se empuja a mano. |
| `fix/matricula-validaciones-backend` | #44 (borrador) | Validaciones de matrícula (fechas de nacimiento, mensajes y códigos). |
| `feat/inscripcion-en-linea` | #45 (borrador) | Todo el flujo de inscripción en línea (punta de la historia). |
| `worktree-agent-*`, `feature/*` antiguas | no se publican | Restos de trabajo local. No usar como base. |

Reglas de partida:

- Trabajo nuevo sobre la inscripción: crea tu rama **desde `feat/inscripcion-en-linea`**.
- Trabajo ajeno a la inscripción: parte de `origin/main`.
- #44 y #45 son independientes entre sí; ambos siguen en borrador. No los marques «listos» ni los fusiones sin que el CI esté en verde y el responsable lo apruebe.
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

1. **Pruebas y CI en verde:** `npm run lint` hoy reporta errores en `src/utils/certificateFile.ts` y `tests/helpers/hostileFiles.ts` por tipos de `sharp` no resueltos en este equipo (verifica con `npm install`), y el lint también recorre `.claude/worktrees/` (conviene excluirlo). Hay pruebas heredadas que no compilan y otras sin arreglar. La deuda de pruebas está en `docs/operations/inscripcion-pruebas-pendientes*.md`.
2. **Despliegue:** backend en Railway (`TRUST_PROXY_HOPS=1`, `NODE_ENV=production`) y frontend en Vercel; configurar Supabase Auth (registros públicos off, contraseña mínima 10, Site URL y redirects) y verificar con `npm run security:check-auth`.
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
