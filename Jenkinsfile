// Pipeline de integración y entrega continua - ColoradosDrive (backend).
// Documentación: docs/operations/jenkins-pipeline.md
// La lógica reutilizable (caché, notificaciones, estado en GitHub) está en ci/pipeline-lib.groovy.

// Módulo cargado en la etapa "Preparación"; se declara fuera de pipeline{} para que
// lo vean todas las etapas y el bloque post.
def lib

// Etapas no bloqueantes que fallaron o se pasaron de tiempo (ej. 'formato', 'auditoría').
// Se declara aquí, igual que lib, para que la lean las ramas paralelas y el bloque post.
def warnings = []

pipeline {
    agent any

    tools {
        nodejs 'node22'
    }

    options {
        timestamps()
        timeout(time: 25, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '15'))
        skipDefaultCheckout()
        disableConcurrentBuilds(abortPrevious: true)
    }

    environment {
        // Mismas variables que el job de .github/workflows/ci.yml.
        DISABLE_CRON = 'true'
        GITHUB_REPO = 'ErickG11/coloradosdrive-backend'
        // Caché de npm compartida entre builds y ramas (fuera del workspace).
        NPM_CONFIG_CACHE = "${JENKINS_HOME}/.npm-cache"
        // Límite de memoria por proceso de Node (agente con ~7 GB en total).
        NODE_OPTIONS = '--max-old-space-size=1536'
    }

    stages {
        stage('Preparación') {
            steps {
                script {
                    def scmVars = checkout scm
                    env.GIT_COMMIT = scmVars.GIT_COMMIT
                    lib = load 'ci/pipeline-lib.groovy'
                    lib.setGithubStatus('pending', "Build #${env.BUILD_NUMBER} en curso")
                }
                sh 'node -v && npm -v'
            }
        }

        stage('Dependencias (caché)') {
            steps {
                script {
                    lib.installDependencies()
                }
            }
        }

        // Solo corren en paralelo las tareas ligeras (Lint, Formato, Auditoría). Los tests no se mezclan
        // aquí porque Jest + ESLint con tipos a la vez agotaron CPU y memoria del agente Docker.
        stage('Calidad (paralelo)') {
            parallel {
                stage('Lint') {
                    steps {
                        script {
                            lib.withStageTimeout('Lint', 8) {
                                sh '''
                                    mkdir -p reports
                                    # Caché de ESLint (.eslintcache) y reporte JSON para archivar.
                                    # Si falla, se repite en formato legible para el log.
                                    npm run lint -- --cache --cache-location .eslintcache -f json -o reports/eslint.json                                         || { rc=$?; npm run lint -- --cache --cache-location .eslintcache || true; exit $rc; }
                                '''
                            }
                        }
                    }
                }
                stage('Formato') {
                    steps {
                        // No bloqueante: el repo ya tiene archivos sin formatear (el CI de GitHub no corre
                        // este paso). El build queda en SUCCESS (el plugin de GitHub trata UNSTABLE como
                        // fallo) y la etapa en amarillo; la advertencia se reporta en Telegram y GitHub.
                        // Cuando se ejecute "npm run format" en el repo, pasar a lib.withStageTimeout.
                        script {
                            lib.runNonBlocking('Formato', 'formato', 8, warnings) {
                                sh 'npm run format:check'
                            }
                        }
                    }
                }
                stage('Auditoría') {
                    steps {
                        // No bloqueante: una vulnerabilidad alta se reporta como advertencia.
                        script {
                            lib.runNonBlocking('Auditoría', 'auditoría', 8, warnings) {
                                sh 'npm audit --audit-level=high'
                            }
                        }
                    }
                }
            }
        }

        // Etapas secuenciales: Jest usa solo 2 workers para no saturar un agente con pocos recursos.
        stage('Tests') {
            when { not { branch 'main' } }
            steps {
                script {
                    lib.withStageTimeout('Tests', 10) {
                        sh 'npm test -- --ci --maxWorkers=2'
                    }
                }
            }
        }

        stage('Tests + cobertura') {
            when { branch 'main' }
            steps {
                script {
                    lib.withStageTimeout('Tests + cobertura', 10) {
                        sh 'npm run test:coverage -- --maxWorkers=2'
                    }
                }
            }
        }

        stage('Tests de BD en memoria') {
            when {
                anyOf {
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                script {
                    lib.withStageTimeout('Tests de BD en memoria', 8) {
                        // PGlite en memoria: no se conecta a Supabase ni a ninguna base real.
                        sh 'npm run test:students-db'
                    }
                }
            }
        }

        stage('Build') {
            steps {
                script {
                    lib.withStageTimeout('Build', 8) {
                        sh 'npm run build'
                    }
                }
            }
        }

        stage('Entrega') {
            when { branch 'main' }
            steps {
                sh '''
                    mkdir -p artifacts
                    tar -czf "artifacts/coloradosdrive-backend-build-${BUILD_NUMBER}.tgz" dist package.json package-lock.json
                '''
                archiveArtifacts artifacts: 'artifacts/*.tgz', fingerprint: true

                // Trabajo futuro: despliegue automático a Railway (no se automatiza en esta entrega).
                // Posible etapa: instalar la CLI de Railway, usar un token de proyecto guardado como
                // credencial de Jenkins y ejecutar "railway up" solo desde main tras aprobación manual.
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'reports/**, coverage/**', allowEmptyArchive: true
            // No se limpia el workspace: node_modules y el marcador del lockfile se usan como caché.
            echo "Duración total: ${currentBuild.durationString.replace(' and counting', '')}"
        }
        success {
            script { if (lib) { lib.notify('SUCCESS', warnings) } }
        }
        failure {
            script { if (lib) { lib.notify('FAILURE', warnings) } }
        }
        unstable {
            script { if (lib) { lib.notify('UNSTABLE', warnings) } }
        }
        aborted {
            script { if (lib) { lib.notify('ABORTED', warnings) } }
        }
    }
}
