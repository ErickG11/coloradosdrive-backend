# ColoradosDrive · Guía de despliegue (Railway + Vercel)

Para quien despliega por primera vez. Backend en **Railway**, frontend en **Vercel**, base de datos y autenticación en **Supabase** (ya existente). Sin dominio propio: se usan `*.up.railway.app` y `*.vercel.app`. Correo por la **API de Gmail** (Railway bloquea SMTP).

Se despliega desde las ramas de trabajo, **sin fusionar a `main`**: backend `feat/inscripcion-en-linea`, frontend `feat/inscripcion-en-linea-ui`.

> **Nunca pegues secretos en el repositorio, en chats ni en capturas.** Los valores de este documento son ejemplos falsos. Los reales se escriben solo en los paneles de Railway y Vercel.

## 1. Orden recomendado

1. Supabase: revisar Authentication (sección 2).
2. Railway: crear el backend con una `FRONTEND_URL` provisional (sección 3).
3. Vercel: crear el frontend con la URL del backend (sección 4).
4. Railway: poner la URL real de Vercel en `FRONTEND_URL` (se redespliega solo).
5. Correo por la API de Gmail (sección 5) y completar las variables de Gmail en Railway.
6. Lista de comprobación (sección 6).

El backend y el frontend se necesitan mutuamente: por eso el paso 2 usa un valor provisional y el paso 4 lo corrige.

## 2. Supabase (Authentication)

Panel de Supabase → tu proyecto → **Authentication**.

1. **URL Configuration** → *Site URL*: la URL de Vercel (`https://tu-app.vercel.app`, sin barra final). En *Redirect URLs* agrega `https://tu-app.vercel.app/**` y `https://tu-app.vercel.app/crear-contrasena` (el enlace de aprobación abre esa ruta). Conserva `http://localhost:3001/**` si seguirás probando en local.
2. **Sign In / Providers** (o *Providers → Email*): desactiva el registro público (*Allow new users to sign up*) y exige contraseña mínima de 10.
3. **Multi-Factor**: TOTP habilitado (el administrador lo enrola; `ADMIN_MFA_REQUIRED` queda en `false` hasta que todos los admins tengan TOTP).
4. Verifica con `npm run security:check-auth` desde el backend, en tu equipo y con tus variables locales.
5. De **Project Settings → API** copia, para Railway y Vercel: la URL del proyecto, la clave *anon* y la clave *service_role*. La *service_role* **solo** va en Railway.

## 3. Railway (backend)

1. Entra a https://railway.com → **New Project** → **Deploy from GitHub repo** → elige `ErickG11/coloradosdrive-backend` (autoriza la app de GitHub si lo pide).
2. Abre el servicio → **Settings** → **Source** → *Branch*: `feat/inscripcion-en-linea`. *Root Directory*: `/` (raíz del repositorio).
3. El repositorio trae `railway.json`: construcción con `npm ci --include=dev && npm run build`, arranque con `npm start` (`node dist/index.js`) y ruta de salud `/health`. No hace falta cambiar nada en **Build/Deploy**. Node se toma de `engines` (22.x), igual que el CI.
4. **Variables** (pestaña *Variables* → *New Variable* o *Raw Editor*). Escribe los valores reales solo aquí:

| Variable | Propósito | ¿Secreta? | De dónde sale | Ejemplo (falso) |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | Modo de ejecución | no | fijo | `production` |
| `DEMO_MODE` | Permite captcha off y pago simulado en production | no | fijo | `true` |
| `DISABLE_CRON` | Apaga los trabajos programados | no | fijo (ver nota) | `false` |
| `TRUST_PROXY_HOPS` | Proxies de confianza para `req.ip` | no | fijo | `1` |
| `FRONTEND_URL` | Origen del frontend (CORS y enlaces de correo) | no | URL de Vercel | `https://tu-app.vercel.app` |
| `CORS_ORIGINS` | Orígenes extra de CORS (opcional, separados por coma) | no | vistas previas de Vercel | `https://tu-app-git-rama.vercel.app` |
| `SUPABASE_URL` | URL del proyecto | no | Supabase → Project Settings → API | `https://abcd.supabase.co` |
| `SUPABASE_ANON_KEY` | Clave pública | no | Supabase → API | `eyJ...falso` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privilegiada | **sí** | Supabase → API | `eyJ...falso` |
| `SOLICITUD_TOKEN_SECRET` | Firma del token del flujo (≥ 32 caracteres) | **sí** | generarla: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` | `cadena-aleatoria-de-48-bytes` |
| `EMAIL_PROVIDER` | Proveedor de correo | no | fijo | `gmail_api` |
| `EMAIL_USER` | Cuenta Gmail remitente | no | tu cuenta | `escuela@example.com` |
| `GMAIL_CLIENT_ID` | OAuth de Google | no | Google Cloud (sección 5) | `1234-abc.apps.googleusercontent.com` |
| `GMAIL_CLIENT_SECRET` | OAuth de Google | **sí** | Google Cloud | `GOCSPX-falso` |
| `GMAIL_REFRESH_TOKEN` | Token de renovación (alcance `gmail.send`) | **sí** | OAuth Playground | `1//falso` |
| `PAYMENT_PROVIDER` | Proveedor de pago | no | fijo (demo) | `simulado` |
| `CAPTCHA_PROVIDER` | Captcha | no | fijo (demo) | `off` |
| `ADMIN_MFA_REQUIRED` | Exige TOTP al admin | no | fijo | `false` |

`PORT` lo inyecta Railway: no lo definas. El resto de variables (topes de inscripción, reservas, versiones del aviso) tiene valores por defecto; ver `.env.example`.

Notas:
- **`TRUST_PROXY_HOPS=1`**: Railway pone un proxy delante del servicio. Con 0 el límite por IP vería siempre la IP del proxy; con más de 1 se podría falsificar la IP con `X-Forwarded-For`.
- **`DISABLE_CRON=false` en UNA sola instancia.** Los cinco trabajos (franjas de práctica, vencimiento de reservas, correo de bienvenida de pago, limpieza y recuperación de aprobaciones) corren dentro del proceso. No escales a más de una réplica: se duplicarían. Durante un redespliegue pueden solaparse unos segundos; es tolerable.
- `NODE_ENV=production` con `CAPTCHA_PROVIDER=off` y `PAYMENT_PROVIDER=simulado` **solo** arranca si `DEMO_MODE=true`. Al arrancar se imprime en los logs: `MODO DEMOSTRACIÓN ACTIVO: captcha y pago simulados; no usar con datos reales`.
- Si falta una variable obligatoria el servicio no arranca y en los logs aparece `Missing required environment variable: NOMBRE`.

5. **Dominio público**: servicio → **Settings** → **Networking** → **Generate Domain**. Copia la URL (`https://xxxx.up.railway.app`).
6. **Probar la salud**: abre `https://xxxx.up.railway.app/health` en el navegador. Debe responder `{"status":"ok", ...}`. También `https://xxxx.up.railway.app/public/inscripcion/config` debe responder JSON con `"demo": true`.

## 4. Vercel (frontend)

1. https://vercel.com → **Add New… → Project** → importa `ErickG11/coloradosdrive-frontend`.
2. *Framework Preset*: Next.js (se detecta). *Root Directory*: la raíz. No hace falta `vercel.json`.
3. **Production Branch**: tras crear el proyecto, **Settings → Git → Production Branch** = `feat/inscripcion-en-linea-ui`, para que esa rama sea el despliegue de producción.
4. **Environment Variables** (antes de desplegar). Se incrustan al construir: si las cambias, **redespliega**.

| Variable | Propósito | ¿Secreta? | De dónde sale | Ejemplo (falso) |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | URL del backend, **sin barra final** | no | dominio de Railway | `https://xxxx.up.railway.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | no | Supabase → API | `https://abcd.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública de Supabase | no | Supabase → API | `eyJ...falso` |

Nunca pongas la *service_role* en Vercel. Con `CAPTCHA_PROVIDER=off` no se necesita la clave de Turnstile (la clave pública la entrega el backend).
5. Pulsa **Deploy**. Copia la URL (`https://tu-app.vercel.app`).
6. Vuelve a Railway y pon esa URL en `FRONTEND_URL` (y, si usas vistas previas, en `CORS_ORIGINS`). Railway redespliega solo. Después ajusta *Site URL* y *Redirect URLs* en Supabase (sección 2) con la URL real.

La CSP del frontend toma el origen del API y de Supabase de esas mismas variables en la construcción; no hay `localhost` escrito en el código de producción.

## 5. Correo por la API de Gmail

El backend envía por HTTPS con OAuth (`EMAIL_PROVIDER=gmail_api`); renueva solo el token de acceso a partir del *refresh token*.

1. https://console.cloud.google.com → selector de proyecto → **Nuevo proyecto** (por ejemplo, "ColoradosDrive").
2. **APIs y servicios → Biblioteca** → busca **Gmail API** → **Habilitar**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth**: tipo **Externo**; nombre de la app; correo de soporte. En **Usuarios de prueba** agrega la cuenta remitente (`EMAIL_USER`). Déjala en modo **Prueba**.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth** → tipo **Aplicación web**. En *URI de redireccionamiento autorizados* agrega `https://developers.google.com/oauthplayground`. Guarda; copia el **ID de cliente** y el **secreto** (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`).
5. https://developers.google.com/oauthplayground → engranaje (arriba a la derecha) → marca **Use your own OAuth credentials** y pega el ID y el secreto.
6. En el paso 1 del Playground escribe el alcance `https://www.googleapis.com/auth/gmail.send` (o `https://mail.google.com/`) → **Authorize APIs** → inicia sesión con la cuenta remitente y acepta.
7. Paso 2 → **Exchange authorization code for tokens** → copia el **Refresh token** (`GMAIL_REFRESH_TOKEN`).
8. Pega `EMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_REFRESH_TOKEN` en Railway.
9. **Probar un envío**: en `/inscripcion` pide un código con un correo tuyo; debe llegar. Si falla, mira los logs de Railway: `invalid_grant` = token revocado o vencido (genera uno nuevo).

Límites: una cuenta personal de Gmail permite del orden de cientos de mensajes al día (consulta el límite vigente de Google). Para la defensa alcanza; no es para uso masivo.

**Importante:** con la pantalla de consentimiento en modo *Prueba*, el refresh token **caduca a los 7 días**. Renuévalo (pasos 5 a 8) **justo antes de la defensa**.

## 6. Lista de comprobación posterior

1. `GET /health` del backend responde `ok`.
2. `GET /public/inscripcion/config` responde con `"demo": true` y cursos.
3. El frontend carga `/inscripcion` y muestra la insignia **Modo demostración**.
4. Flujo de solicitud completo con un correo propio: llega el código, se envía la solicitud y llega el acuse.
5. Como administrador: revisar, verificar identidad y estudios y **aprobar**; llega el correo con el enlace `/crear-contrasena` y se puede crear la contraseña.
6. Como alumno: elegir horario, **reservar** y pagar con el pago **simulado**; queda la matrícula activa.
7. Revisar los logs de Railway: sin errores repetidos.

## 7. Problemas frecuentes

- **Error de CORS en el navegador**: `FRONTEND_URL` (o `CORS_ORIGINS`) no coincide exactamente con el origen del frontend (esquema y host, sin barra final ni ruta). Corrige y espera el redespliegue.
- **El frontend llama a `localhost` o a una URL vieja**: `NEXT_PUBLIC_API_URL` se incrusta al construir; cámbiala y **redespliega** el frontend.
- **Se inicia sesión pero vuelve a `/login`**: revisa `NEXT_PUBLIC_SUPABASE_URL` y la clave anon, y que el backend responda `account-status` (el servidor de Vercel lo consulta en cada navegación).
- **El enlace de aprobación no abre o falla**: revisa *Site URL* y *Redirect URLs* de Supabase y que `FRONTEND_URL` sea la URL real de Vercel.
- **Railway no arranca**: mira *Deployments → View logs*; lo más común es una variable faltante o `CAPTCHA_PROVIDER`/`PAYMENT_PROVIDER` incompatibles sin `DEMO_MODE=true`.
- **`invalid_grant` al enviar correo**: el refresh token caducó (modo Prueba, 7 días) o se revocó; genera uno nuevo.
- **La salud tarda o falla justo tras desplegar**: el healthcheck espera hasta 120 s.

## 8. Volver al modo estricto

Cuando existan Turnstile (F43) y la certificación de Kushki:
1. En Railway pon `DEMO_MODE=false` (o bórrala), `CAPTCHA_PROVIDER=turnstile` con `TURNSTILE_SECRET_KEY` y `NEXT_PUBLIC_TURNSTILE_SITE_KEY` reales (no las claves de prueba de Cloudflare), y `PAYMENT_PROVIDER=manual` o `kushki` (con sus cinco variables).
2. El frontend debe tener el widget de Turnstile y permitir su origen en la CSP.
3. Sin `DEMO_MODE`, el backend vuelve a negarse a arrancar con captcha off o pago simulado en producción: esa es la protección.

## 9. Advertencias

- **Local y despliegue comparten la misma base de datos de Supabase.** Lo que pruebes en uno lo ve el otro; no borres ni modifiques datos sin avisar.
- El plan gratuito de Supabase **pausa el proyecto tras una semana sin actividad**. Entra al panel y reactívalo (o haz una visita al sistema) antes de la defensa.
- Los datos de prueba son ficticios: no registres datos personales reales en el modo demostración.
