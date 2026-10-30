# Pipeline de CircleCI del backend

La configuración está en `.circleci/config.yml` (versión 2.1). Traduce los comandos del `Jenkinsfile` y `ci/pipeline-lib.groovy` presentes en `main`, que se conservan intactos. No despliega la aplicación ni requiere servicios de base de datos: `test:students-db` usa PGlite en memoria.

## Estrategias y beneficios

| Estrategia          | Dónde está en el config (job o command)                                                                        | Qué beneficio da                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caché               | `install`, command `install_deps`: `restore_cache`, `save_cache`, checksum de `package-lock.json`              | Reutiliza `node_modules` y la caché de npm entre ejecuciones con el mismo lockfile; el marcador SHA-256 permite omitir `npm ci`. La clave incluye arquitectura y versión mayor de Node. |
| Paralelismo         | Workflow `backend`: `lint`, `format`, `audit` requieren solamente `install`                                    | Las tres comprobaciones ligeras pueden ejecutarse simultáneamente. Los tests esperan a las tres para evitar la concurrencia de ESLint y Jest que agotó memoria en Jenkins.              |
| Ejecución selectiva | `filters.branches` en `test`, `test_coverage`, `test_db`, `delivery`; dependencias de `build`                  | Fuera de `main` ejecuta tests normales; en `main`, cobertura, BD y entrega. `build` corre en todas las ramas cuando pasan sus predecesores. Reduce trabajo en ramas de desarrollo.      |
| Modularidad         | Executor `node22`; commands `prepare_job`, `install_deps`, `execute_check`, `notify_telegram` y sus parámetros | Centraliza imagen, entorno, preparación, límites, captura de resultados y notificaciones; permite cambiar un comportamiento compartido en un lugar.                                     |

La imagen concreta es `cimg/node:22.22`, una versión de la familia 22.x; `22.x` no se usa como etiqueta literal. El executor parametriza la etiqueta. Mantiene `NODE_OPTIONS=--max-old-space-size=1536` y `DISABLE_CRON=true`. Cada job usa un contenedor `medium` independiente. Jest conserva `--maxWorkers=2`; no se divide la suite entre contenedores.

## Flujo y comandos

```text
install -> lint + format + audit
  otras ramas: -> test -> build
  main:        -> test_coverage -> test_db -> build -> delivery
  jobs terminales -> notify
```

Los comandos de Jenkins se mantienen:

- Instalación ante caché ausente o marcador diferente: `npm ci --prefer-offline --no-audit --no-fund`.
- ESLint: `npm run lint -- --cache --cache-location .eslintcache -f json -o reports/eslint.json`; si falla, se repite `npm run lint -- --cache --cache-location .eslintcache` para mostrar errores legibles, conservando el primer código de salida.
- Formato: `npm run format:check`.
- Auditoría: `npm audit --audit-level=high`, sin añadir flags que oculten dependencias.
- Tests fuera de `main`: `npm test -- --ci --maxWorkers=2`.
- Cobertura en `main`: `npm run test:coverage -- --maxWorkers=2`.
- BD en `main`: `npm run test:students-db`.
- Compilación: `npm run build`.
- Entrega: `tar -czf "artifacts/coloradosdrive-backend-build-${CIRCLE_BUILD_NUM}.tgz" dist package.json package-lock.json`.

`install` comparte `node_modules` mediante workspace; `build` añade `dist`. `delivery` recupera esos archivos, hace checkout de los manifiestos del mismo commit y publica el `.tgz` con `store_artifacts`. Lint y cobertura también publican sus informes. No se incluyen secretos ni `.env` en el paquete.

`execute_check` usa `timeout` de GNU: 8 minutos por comprobación y 10 para Jest, como Jenkins; tras TERM permite 10 segundos antes de KILL. Guarda el código de salida antes de devolver el fallo. Cada job persiste únicamente `job-results/<nombre>.*`, evitando colisiones entre capas del workspace, incluso cuando hereda resultados anteriores.

## Diferencias con Jenkins

### Advertencias y estado UNSTABLE

CircleCI no ofrece `UNSTABLE`. Formato y auditoría capturan cualquier código distinto de cero, incluidos timeouts, imprimen una advertencia y guardan archivos `.warning` y `.status`; el job termina correctamente. Los demás comandos devuelven su código original después de persistir el resultado y bloquean los jobs posteriores si fallan.

El job adicional `notify` espera estados `terminal` de sus dependencias, incluidos fallos y jobs bloqueados. Las dependencias excluidas por filtros se ignoran. Reúne las advertencias y comprueba que existan resultados de todos los comandos esperados para la rama; un resultado ausente cuenta como fallo. Así no se envía éxito simplemente porque el último job haya quedado bloqueado. Se pierde el color amarillo de la etapa en Jenkins: hay que consultar logs, workspace o Telegram para reconocer advertencias.

### Equivalente de changeRequest()

No se simula `changeRequest()` mediante un filtro de rama: una rama también puede existir sin PR. Por el requisito de esta entrega, `test_db` tiene `branches.only: main`, por lo que se pierde la prueba de BD en PR que Jenkins sí ejecuta. Los PR conservan tests unitarios y build en su rama. Una futura equivalencia requeriría condiciones basadas en metadatos de PR y en la integración de CircleCI utilizada, y cambiaría la política solicitada.

### Caché y lugar de ejecución

Jenkins local en Docker conserva el workspace, `node_modules`, el marcador SHA-256, `.eslintcache` y la caché npm en `JENKINS_HOME`. CircleCI Cloud arranca contenedores independientes: guarda dependencias en una caché remota inmutable por clave y comparte archivos de una ejecución mediante un workspace aditivo. No se usa una clave alternativa parcial para evitar restaurar módulos de otro lockfile. Subir/restaurar cachés y transferir workspaces también consume tiempo y almacenamiento. `.eslintcache` se usa dentro del job de lint, pero no se conserva entre workflows; esta optimización de Jenkins no se replica.

### Notificaciones por estado

Los pasos `run` distinguen `on_success`, `on_fail` y `always` dentro del job, no estados globales de workflow. `notify` convierte los resultados registrados en éxito o fallo local y llama al command `notify_telegram` con `on_success` y `on_fail`. Incluye emoji, rama, commit corto, número y enlace del build de notificación, y las advertencias disponibles. Los números de job de CircleCI no son un número global como `BUILD_NUMBER` de Jenkins; el `.tgz` usa el número del job `delivery`.

El command lee exclusivamente `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` del entorno del proyecto. Desactiva trazas y limita el tiempo de curl; variables ausentes o errores HTTP/red no rompen el build. No se publica un estado GitHub personalizado con credenciales: se usan los checks propios de CircleCI.

Cancelaciones manuales, pérdida del executor y errores de infraestructura pueden impedir persistir resultados o ejecutar notificaciones; no se promete un aviso equivalente a `post.aborted`. La agregación comprueba códigos de los comandos, no errores posteriores de subida de artefactos/caché; ante esos errores el estado del workflow en CircleCI es la referencia. Tampoco se replican automáticamente el timeout global de 25 minutos, la retención de 15 builds ni `disableConcurrentBuilds(abortPrevious: true)` de Jenkins; retención y concurrencia se administran en CircleCI.

## Comparación del tiempo de ejecución

No se han medido tiempos en CircleCI. Para el informe, ejecutar el mismo commit en ambas plataformas con caché fría y caliente, registrar duración total y por etapa, tamaño/tiempo de caché y workspace, y repetir al menos tres veces para comparar medianas. Separar `main` de otras ramas porque ejecutan trabajo diferente.

El tramo de calidad tiene una duración ideal cercana al máximo de lint, formato y auditoría, en lugar de su suma, siempre que el plan permita tres jobs concurrentes. Esto ya se hacía en Jenkins; la diferencia en CircleCI es el aislamiento por contenedor y el coste de arranque y transferencia. Los tests siguen siendo secuenciales; no se atribuye una mejora de tiempo sin medirla. El job final de notificación también añade arranque y descarga de workspace.

## Verificación y referencias

Si está instalado: `circleci config validate .circleci/config.yml`. Como alternativa, un parser YAML verifica sintaxis, pero no sustituye la validación del esquema ni una ejecución real en CircleCI. Antes de integrar, comprobar una rama y `main`, caché fría/caliente, fallo de lint, fallo/timeout no bloqueante y Telegram. No se necesita ninguna credencial de BD para PGlite.

Validación local realizada: parser YAML de Ruby, sintaxis de los scripts con `bash -n`, simulación de fallo bloqueante, advertencias, timeout y agregación de resultados, revisión de filtros para `main` y una rama, Prettier y búsqueda de secretos en los dos archivos. CircleCI CLI no estaba instalado; no se ha validado el esquema con su CLI ni ejecutado el workflow en cloud o enviado Telegram. Los tiempos siguen pendientes de medición.

Referencias oficiales: [configuración y dependencias flexibles](https://circleci.com/docs/reference/configuration-reference/), [workspaces](https://circleci.com/docs/guides/orchestrate/workspaces/) e [imagen cimg/node](https://circleci.com/developer/images/image/cimg/node).
