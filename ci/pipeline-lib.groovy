// Módulo reutilizable del pipeline de ColoradosDrive (backend).
// Se carga desde el Jenkinsfile con: lib = load 'ci/pipeline-lib.groovy'
// Todo uso de credenciales vive aquí. Los secretos solo se pasan al shell como
// variables de entorno (withCredentials) y nunca se interpolan desde Groovy.

/**
 * Instala dependencias con doble caché:
 *  (a) caché de npm (NPM_CONFIG_CACHE) -> --prefer-offline
 *  (b) si el SHA-256 de package-lock.json coincide con el marcador guardado en
 *      node_modules, se omite npm ci por completo (CACHE HIT).
 */
def installDependencies() {
    // Marcador guardado dentro de node_modules: indica con qué lockfile se instaló.
    def LOCK_MARKER = 'node_modules/.package-lock.sha256'
    def lockHash = sh(script: "sha256sum package-lock.json | cut -d' ' -f1", returnStdout: true).trim()
    def savedHash = sh(
        script: "if [ -d node_modules ] && [ -f ${LOCK_MARKER} ]; then cat ${LOCK_MARKER}; fi",
        returnStdout: true
    ).trim()

    if (lockHash && lockHash == savedHash) {
        echo "CACHE HIT: package-lock.json no cambió (sha256 ${lockHash.take(12)}...). Se omite npm ci y se conserva .eslintcache."
        return
    }

    echo "CACHE MISS: lockfile nuevo o node_modules ausente. Ejecutando npm ci (caché npm en ${env.NPM_CONFIG_CACHE})."
    // Las dependencias cambiaron (puede cambiar ESLint o sus reglas): se descarta la caché de ESLint.
    sh 'rm -f .eslintcache'
    sh 'npm ci --prefer-offline --no-audit --no-fund'
    // npm ci borra node_modules antes de instalar, por eso el marcador se escribe al final.
    withEnv(["LOCK_HASH=${lockHash}"]) {
        sh "printf '%s' \"\$LOCK_HASH\" > ${LOCK_MARKER}"
    }
}

/**
 * Ejecuta el cuerpo con un límite de tiempo. Si se agota, la etapa queda en FAILURE
 * (no en ABORTED, que es lo que hace timeout por defecto) con un mensaje claro.
 */
def withStageTimeout(String stageName, int minutes, Closure body) {
    def startMs = System.currentTimeMillis()
    try {
        timeout(time: minutes, unit: 'MINUTES') {
            body()
        }
    } catch (e) {
        def elapsedMs = System.currentTimeMillis() - startMs
        // Interrupción por el límite: el tiempo transcurrido alcanza el máximo (margen de 5 s).
        if (elapsedMs >= minutes * 60000L - 5000L) {
            error "TIMEOUT: la etapa '${stageName}' superó el límite de ${minutes} minutos y se canceló. " +
                'Revisar CPU y memoria del agente (procesos colgados o sin recursos).'
        }
        throw e
    }
}

/**
 * Publica el estado del commit en GitHub (pending | success | failure | error).
 * Nunca rompe el build: cualquier fallo de red o de permisos se ignora.
 */
def setGithubStatus(String state, String description) {
    if (!env.GIT_COMMIT || !env.GITHUB_REPO) {
        echo 'setGithubStatus: falta GIT_COMMIT o GITHUB_REPO, se omite.'
        return
    }
    // Descripción limitada a 140 caracteres (máximo de la API) y sin comillas ni saltos de línea.
    def safeDesc = description.replaceAll(/["\\\r\n]/, ' ').take(140)
    withEnv(["GH_STATE=${state}", "GH_DESC=${safeDesc}"]) {
        withCredentials([usernamePassword(
            credentialsId: 'github-private-repo',
            usernameVariable: 'GH_USER',
            passwordVariable: 'GH_TOKEN'
        )]) {
            sh '''
                set +x
                BODY=$(printf '{"state":"%s","context":"jenkins/ci-backend","description":"%s","target_url":"%s"}' \
                    "$GH_STATE" "$GH_DESC" "$BUILD_URL")
                curl -s -o /dev/null -w "GitHub status HTTP %{http_code}\\n" \
                    -u "$GH_USER:$GH_TOKEN" \
                    -H "Accept: application/vnd.github+json" \
                    -X POST "https://api.github.com/repos/${GITHUB_REPO}/statuses/${GIT_COMMIT}" \
                    -d "$BODY" || true
            '''
        }
    }
}

/**
 * Envía el resultado a Telegram y actualiza el estado del commit en GitHub.
 * status: SUCCESS | FAILURE | UNSTABLE | ABORTED
 */
def notify(String status) {
    def emoji = [SUCCESS: '✅', FAILURE: '❌', UNSTABLE: '⚠️', ABORTED: '⏹️'].get(status, 'ℹ️')
    // UNSTABLE sigue siendo un build que compila y pasa tests: en GitHub se marca como success.
    def ghState = [SUCCESS: 'success', FAILURE: 'failure', UNSTABLE: 'success', ABORTED: 'error'].get(status, 'error')

    def branch = env.BRANCH_NAME ?: 'desconocida'
    def shortCommit = env.GIT_COMMIT ? env.GIT_COMMIT.take(7) : 'n/a'
    def message = "${emoji} ColoradosDrive backend: ${status}\n" +
        "Rama: ${branch}\n" +
        "Commit: ${shortCommit}\n" +
        "Build: #${env.BUILD_NUMBER}\n" +
        "Duración: ${currentBuild.durationString.replace(' and counting', '')}\n" +
        "${env.BUILD_URL}"

    withEnv(["TG_TEXT=${message}"]) {
        withCredentials([
            string(credentialsId: 'telegram-bot-token', variable: 'TG_TOKEN'),
            string(credentialsId: 'telegram-chat-id', variable: 'TG_CHAT')
        ]) {
            sh '''
                set +x
                curl -s -o /dev/null -w "Telegram HTTP %{http_code}\\n" \
                    "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
                    --data-urlencode "chat_id=${TG_CHAT}" \
                    --data-urlencode "text=${TG_TEXT}" || true
            '''
        }
    }

    setGithubStatus(ghState, "Build #${env.BUILD_NUMBER}: ${status}")
}

return this
