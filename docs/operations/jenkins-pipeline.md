# Pipeline de entrega continua con Jenkins (backend)

Documento de apoyo para el informe de "Pipeline de entrega continua + estrategias de optimización".
Archivos relacionados: `Jenkinsfile` y `ci/pipeline-lib.groovy`.

## 1. Estrategia de branching: GitHub Flow

- `main` siempre es desplegable y está protegida.
- Todo cambio nace en una rama corta (`feat/*`, `fix/*`, `ci/*`), se sube a GitHub y se integra a `main` mediante Pull Request.
- No hay rama `develop`: el PR a `main` es el punto de integración.

| Situación | Rama en Jenkins | Qué ejecuta el pipeline |
|---|---|---|
| Rama de feature | `feat/xyz` | Preparación, dependencias, lint, formato, auditoría, `npm test -- --ci --maxWorkers=2`, build. Sin tests de BD, sin cobertura y sin entrega. |
| Pull Request | `PR-<n>` | Lo mismo que una feature, más los tests de BD en memoria (`test:students-db`). |
| `main` | `main` | Lint, formato, auditoría, tests con cobertura, tests de BD en memoria, build y **Entrega** (paquete `.tgz` archivado con fingerprint). |

### Orden de etapas

1. **Preparación**: checkout, carga del módulo y estado `pending` en GitHub.
2. **Dependencias (caché)**: `npm ci` solo si cambió el lockfile.
3. **Calidad (paralelo)**: Lint, Formato y Auditoría a la vez (tareas ligeras).
4. **Tests** (features y PR) o **Tests + cobertura** (`main`), de forma secuencial y con `--maxWorkers=2`.
5. **Tests de BD en memoria** (`main` y PR).
6. **Build**.
7. **Entrega** (solo `main`).

### Límites de tiempo y recursos

- Cada rama de Calidad y la etapa Build tienen `timeout` de 8 minutos; los tests, 10 minutos. Si se agota, la etapa queda en **FAILURE** con el mensaje `TIMEOUT: la etapa '<nombre>' superó el límite de N minutos...` (lo implementa `withStageTimeout` en `ci/pipeline-lib.groovy`). El límite global del pipeline sigue siendo 25 minutos.
- `NODE_OPTIONS=--max-old-space-size=1536` limita la memoria de cada proceso de Node.
- Jest corre con `--maxWorkers=2` en lugar de un worker por CPU.

En todos los casos se notifica a Telegram y se marca el estado del commit en GitHub (`jenkins/ci-backend`).

## 2. Estrategias de optimización

| Estrategia | Dónde está en el código | Beneficio |
|---|---|---|
| Ejecución en paralelo | `Jenkinsfile`, etapa **Calidad (paralelo)**: Lint, Formato y Auditoría corren a la vez | El tiempo de la etapa es el de la rama más lenta, no la suma de todas. Los tests quedan fuera a propósito para no saturar el agente. |
| Caché de ESLint | `Jenkinsfile`, rama Lint (`--cache --cache-location .eslintcache`); `ci/pipeline-lib.groovy` la descarta cuando cambian las dependencias | Solo se vuelven a analizar los archivos modificados: en local el segundo lint pasó de 35 s a 7 s. |
| Límites de recursos y fallo rápido | `Jenkinsfile` (`NODE_OPTIONS`, `--maxWorkers=2`) y `withStageTimeout` en `ci/pipeline-lib.groovy` | Un agente pequeño no se agota y un cuelgue falla en minutos con un mensaje claro, no en 25. |
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
- `npm run format:check` falla hoy en 43 archivos de `src/` y `tests/` (aparte de los finales de línea). Por eso la etapa Formato es no bloqueante (ver sección 6). Al formatear el repo se puede volver a bloquear.
- Una vulnerabilidad alta en `npm audit` es una advertencia, no un fallo (ver sección 6).
- La caché de ESLint y de `node_modules` vive en el workspace del agente; si se borra, el siguiente build es completo.
- No hay SonarQube ni análisis estático más allá de ESLint.
- No hay despliegue automático: la etapa Entrega solo genera el paquete. El despliegue a Railway queda como trabajo futuro (comentado en el `Jenkinsfile`).
- Un build `UNSTABLE` (por ejemplo, por un test inestable) se reporta como `success` en GitHub y como `UNSTABLE` en Telegram.

## 6. Etapas no bloqueantes y advertencias

Formato y Auditoría **no bloquean** el build: si fallan o se pasan de tiempo, la etapa se marca en amarillo (UNSTABLE) en Stages, pero el resultado global del build sigue en **SUCCESS**.

**Por qué:** el plugin de GitHub de Jenkins publica los checks `continuous-integration/jenkins/branch` y `continuous-integration/jenkins/pr-head` y trata un build UNSTABLE como fallido (❌). Eso ensuciaba el PR aunque lint, tests y build pasaran.

**Cómo no se esconden los problemas:** `runNonBlocking` (en `ci/pipeline-lib.groovy`) agrega el nombre de la etapa a la lista `warnings` del `Jenkinsfile`. Si la lista no está vacía, `notify` incluye la línea `Advertencias: formato, auditoría` en el mensaje de Telegram y en la descripción del estado `jenkins/ci-backend` de GitHub. Si fallan Lint, Tests o Build, el build sigue terminando en FAILURE.

**Plan:** Formato y Auditoría pasarán a ser bloqueantes cuando se aplique `npm run format` y se corrijan las dependencias vulnerables, cada cosa en un PR aparte. Entonces bastará con cambiar `lib.runNonBlocking(...)` por `lib.withStageTimeout(...)` en esas dos etapas.

## 7. Problemas encontrados y cómo se resolvieron

**Síntoma:** el build #2 quedó 24 minutos en las ramas paralelas Lint y Tests, sin escribir nada en el log, mientras Formato y Auditoría terminaron en 16 s. En local los mismos comandos funcionaban.

**Causa:** el contenedor de Jenkins (Docker sobre WSL2 en Windows) veía 16 CPUs. Jest usa por defecto un worker por CPU menos uno (unos 15 workers de ts-jest) y, al mismo tiempo, ESLint con reglas que usan tipos (`parserOptions.project`) analizaba todo el proyecto. Con unos 6,8 GB de memoria disponible, los procesos agotaron la memoria y el build se quedó colgado sin fallar.

**Mitigación en el pipeline:**
- Tests separados de la etapa paralela y ejecutados con `--maxWorkers=2`.
- `NODE_OPTIONS=--max-old-space-size=1536` para limitar cada proceso de Node.
- `timeout` de 8 minutos (10 en tests) por etapa, con mensaje claro y resultado FAILURE.
- Caché de ESLint para reducir el trabajo de lint en builds repetidos.

**Mitigación en el entorno** (`%UserProfile%\.wslconfig` en el PC Windows, y luego `wsl --shutdown` y reiniciar Docker Desktop):

```ini
[wsl2]
processors=4
memory=7GB
```
