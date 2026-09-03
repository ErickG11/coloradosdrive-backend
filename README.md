# ColoradosDrive — Backend

Backend REST para ColoradosDrive, plataforma de gestión de una escuela de conducción en Ecuador (proyecto de titulación). Expone la API que consume el frontend: gestión de usuarios, cursos, cohortes e inscripciones, con autenticación y autorización basadas en Supabase Auth.

## Arquitectura

API REST desacoplada, desplegada como **proceso persistente** (no serverless) en Railway. Esto es deliberado: el backend debe mantener conexiones WebSocket abiertas hacia Supabase Realtime, algo que las funciones serverless no soportan de forma nativa. Ver [docs/adr/001-arquitectura-desacoplada.md](docs/adr/001-arquitectura-desacoplada.md) para el detalle de la decisión.

## Stack

- **Node.js 18 LTS** + **Express.js 4.18** + **TypeScript 5.3**
- **PostgreSQL** vía **Supabase** (Auth, Realtime, Base de datos)
- **Helmet 7.1** — cabeceras de seguridad HTTP
- **express-validator** — validación de entradas
- **jsonwebtoken** — verificación de JWT emitidos por Supabase Auth
- **Nodemailer** — envío de correo (SMTP genérico; en este proyecto vía Resend)
- **ESLint** (flat config, ESLint 9) + **Prettier**
- **Jest** + **Supertest** — testing
- Migraciones SQL versionadas (sin cambios manuales en el dashboard de Supabase)

## Estructura de carpetas

```
src/
  config/        # env vars y cliente de Supabase
  routes/        # definición de rutas, sin lógica
  controllers/   # orquestan request → service → response, sin lógica de negocio
  services/      # lógica de negocio; reciben dependencias por constructor (mockeables en tests)
  middlewares/   # auth JWT, RBAC, manejo de errores centralizado, validación
  models/        # tipos/interfaces TypeScript de las entidades
  utils/
migrations/      # SQL versionado y numerado (001_init.sql, 002_..., ...)
tests/
  unit/
  integration/
docs/
  adr/           # Architecture Decision Records
```

## Cómo levantar el entorno local

### Requisitos previos

- Node.js 18.x
- Un proyecto de Supabase (URL, anon key, service role key y JWT secret — en Project Settings → API)
- Una cuenta SMTP para el correo de bienvenida (host, puerto, usuario y contraseña) — en este proyecto, [Resend vía SMTP](https://resend.com/docs/send-with-smtp)

### Pasos

1. Clonar el repositorio e instalar dependencias:

   ```bash
   git clone https://github.com/ErickG11/coloradosdrive-backend.git
   cd coloradosdrive-backend
   npm install
   ```

2. Copiar `.env.example` a `.env` y completar los valores reales:

   ```bash
   cp .env.example .env
   ```

3. Aplicar las migraciones en `migrations/` al proyecto de Supabase (vía SQL Editor del dashboard de Supabase o el CLI de Supabase), en orden numérico.

4. Levantar el servidor en modo desarrollo (con recarga automática):

   ```bash
   npm run dev
   ```

   El servidor queda escuchando en `http://localhost:3000` (o el `PORT` configurado). Verificar con:

   ```bash
   curl http://localhost:3000/health
   ```

### Otros scripts disponibles

| Script                 | Descripción                                |
| ---------------------- | ------------------------------------------ |
| `npm run build`        | Compila TypeScript a `dist/`               |
| `npm start`            | Corre el build compilado (`dist/index.js`) |
| `npm run lint`         | Corre ESLint                               |
| `npm run lint:fix`     | Corre ESLint con `--fix`                   |
| `npm run format`       | Formatea el código con Prettier            |
| `npm run format:check` | Verifica el formato sin modificar archivos |

## Cómo correr los tests

```bash
npm test              # corre toda la suite (unit + integration)
npm run test:watch    # modo watch
npm run test:coverage # con reporte de cobertura
```

Los tests no requieren un proyecto de Supabase real ni una cuenta SMTP real: `tests/setupEnv.ts` provee variables de entorno de prueba, y `config/supabase.ts`/`config/mailer.ts` se mockean con `jest.mock` en los tests que los necesitan.

## Endpoints

Todos los endpoints de negocio (todo excepto `GET /health`) requieren `Authorization: Bearer <jwt de Supabase Auth>` y rol `admin` (RF-01: solo el administrador puede crear y editar matrículas).

| Método  | Ruta           | Descripción                                                                                                                                            |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`   | `/health`      | Estado del servidor (sin auth)                                                                                                                         |
| `POST`  | `/cohorts`     | Crea una cohorte                                                                                                                                       |
| `GET`   | `/cohorts`     | Lista las cohortes                                                                                                                                     |
| `PATCH` | `/cohorts/:id` | Edita una cohorte                                                                                                                                      |
| `POST`  | `/enrollments` | Matricula un estudiante: crea su cuenta (Supabase Auth + `users`), lo inscribe en una cohorte, y le envía el correo de bienvenida con sus credenciales |

## Frontend

Repositorio del frontend: https://github.com/ErickG11/coloradosdrive-frontend
