# Pipeline de entrega continua con Jenkins (backend)

Documento de apoyo para el informe de "Pipeline de entrega continua + estrategias de optimización".
Archivos relacionados: `Jenkinsfile` y `ci/pipeline-lib.groovy`.

## 1. Estrategia de branching: GitHub Flow

- `main` siempre es desplegable y está protegida.
- Todo cambio nace en una rama corta (`feat/*`, `fix/*`, `ci/*`), se sube a GitHub y se integra a `main` mediante Pull Request.
- No hay rama `develop`: el PR a `main` es el punto de integración.

| Situación | Rama en Jenkins | Qué ejecuta el pipeline |
|---|---|---|
| Rama de feature | `feat/xyz` | Preparación, dependencias, lint, formato, auditoría, `npm test -- --ci`, build. Sin tests de BD, sin cobertura y sin entrega. |
| Pull Request | `PR-<n>` | Lo mismo que una feature, más los tests de BD en memoria (`test:students-db`). |
| `main` | `main` | Lint, formato, auditoría, tests con cobertura, tests de BD en memoria, build y **Entrega** (paquete `.tgz` archivado con fingerprint). |

En todos los casos se notifica a Telegram y se marca el estado del commit en GitHub (`jenkins/ci-backend`).

## 2. Estrategias de optimización

| Estrategia | Dónde está en el código | Beneficio |
|---|---|---|
| Ejecución en paralelo | `Jenkinsfile`, etapa **Calidad (paralelo)**: Lint, Formato, Auditoría y Tests corren a la vez | El tiempo de la etapa es el de la rama más lenta, no la suma de todas. Con 2 ejecutores se aprovechan ambos. |
| Caché de npm | `Jenkinsfile` (`NPM_CONFIG_CACHE` en `JENKINS_HOME`) y `ci/pipeline-lib.groovy` (`installDependencies`, `--prefer-offline`) | Aunque haga falta `npm ci`, los paquetes se leen del disco y no de la red. |
| Caché de `node_modules` por hash del lockfile | `ci/pipeline-lib.groovy`, `installDependencies()`; etapa **Dependencias (caché)** | Si el SHA-256 de `package-lock.json` no cambió, se omite `npm ci` (log: `CACHE HIT`). |
| Ejecución selectiva | `Jenkinsfile`, bloques `when` de Tests, Tests + cobertura, Tests de BD y Entrega | Las ramas de feature son rápidas; el trabajo costoso (cobertura, BD, empaquetado) solo ocurre en `main` o PR. |
| Pipeline modular | `ci/pipeline-lib.groovy` cargado con `load` | La lógica de caché, Telegram y GitHub vive en un módulo reutilizable y el `Jenkinsfile` queda legible. |
| Cancelación de builds obsoletos | `disableConcurrentBuilds(abortPrevious: true)` | Un push nuevo aborta el build anterior de la misma rama y libera ejecutores. |

## 3. Configuración de Jenkins

1. **Herramienta Node.js**: Administrar Jenkins > Tools > NodeJS installations > agregar una con nombre exacto `node22` (versión 22.x; el backend exige `>=22 <23`). Requiere el plugin NodeJS.
2. **Credenciales** (ámbito Global):
   - `github-private-repo`: usuario y contraseña (usuario de GitHub + token con permiso de lectura del repo y de escritura de *commit statuses*).
   - `telegram-bot-token`: secret text.
   - `telegram-chat-id`: secret text.
3. **Job Multibranch Pipeline**:
   - Branch Source: GitHub (o Git) con URL `https://github.com/ErickG11/coloradosdrive-backend.git` y credencial `github-private-repo`.
   - Build Configuration: by Jenkinsfile, ruta `Jenkinsfile`.
   - Scan Multibranch Pipeline Triggers: *Periodically if not otherwise run* cada **5 minutos**. Jenkins corre en local y GitHub no puede enviarle webhooks.
4. Requisitos del agente: `curl`, `tar` y `sha256sum` (incluidos en la imagen `jenkins/jenkins:lts-jdk17`).

## 4. Evidencias a capturar

1. **Stage View** de un build completo.
2. **Paralelo**: vista de Blue Ocean o Pipeline Graph con las ramas de Calidad ejecutándose a la vez.
3. **CACHE HIT** en el log de la etapa Dependencias del segundo build (y `CACHE MISS` en el primero).
4. **Feature vs main**: Stage View de una rama de feature (sin cobertura ni Entrega) junto a la de `main` (con ambas).
5. **Artefacto** `coloradosdrive-backend-build-<n>.tgz` archivado en `main`.
6. **Mensajes de Telegram** de un build exitoso y uno fallido.
7. **Estado en GitHub**: check verde y rojo del contexto `jenkins/ci-backend` en un commit o PR.

## 5. Limitaciones

- Jenkins corre en una PC local: no recibe webhooks (se usa escaneo cada 5 minutos) y solo funciona mientras la PC está encendida.
- Los tests de integración usan mocks de Supabase, correo y JWKS; no validan contra servicios reales. Los tests de BD usan PGlite en memoria, no la base de Supabase.
- `npm run format:check` falla hoy en 43 archivos de `src/` y `tests/` (aparte de los finales de línea). Por eso la etapa Formato es no bloqueante (marca el build como inestable). Al formatear el repo se puede volver a bloquear.
- Una vulnerabilidad alta en `npm audit` deja el build inestable, no fallido.
- No hay SonarQube ni análisis estático más allá de ESLint.
- No hay despliegue automático: la etapa Entrega solo genera el paquete. El despliegue a Railway queda como trabajo futuro (comentado en el `Jenkinsfile`).
- Un build inestable se reporta como `success` en GitHub y como `UNSTABLE` en Telegram.
