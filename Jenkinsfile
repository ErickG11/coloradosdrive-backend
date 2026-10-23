// Pipeline de integración y entrega continua - ColoradosDrive (backend).
// Documentación: docs/operations/jenkins-pipeline.md
// La lógica reutilizable (caché, notificaciones, estado en GitHub) está en ci/pipeline-lib.groovy.

// Módulo cargado en la etapa "Preparación"; se declara fuera de pipeline{} para que
// lo vean todas las etapas y el bloque post.
def lib

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

        stage('Calidad (paralelo)') {
            parallel {
                stage('Lint') {
                    steps {
                        sh '''
                            mkdir -p reports
                            # Reporte JSON para archivar; si falla, se repite en formato legible para el log.
                            npm run lint -- -f json -o reports/eslint.json || { rc=$?; npm run lint || true; exit $rc; }
                        '''
                    }
                }
                stage('Formato') {
                    steps {
                        // El repo ya tiene archivos sin formatear (el CI de GitHub no corre este paso),
                        // por eso marca el build como inestable en vez de bloquearlo.
                        // Cuando se ejecute "npm run format" en el repo, quitar el catchError.
                        catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') {
                            sh 'npm run format:check'
                        }
                    }
                }
                stage('Auditoría') {
                    steps {
                        // Una vulnerabilidad alta marca el build como inestable, no lo bloquea.
                        catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') {
                            sh 'npm audit --audit-level=high'
                        }
                    }
                }
                stage('Tests') {
                    when { not { branch 'main' } }
                    steps {
                        sh 'npm test -- --ci'
                    }
                }
                stage('Tests + cobertura') {
                    when { branch 'main' }
                    steps {
                        sh 'npm run test:coverage'
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
                        // PGlite en memoria: no se conecta a Supabase ni a ninguna base real.
                        sh 'npm run test:students-db'
                    }
                }
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
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
            script { if (lib) { lib.notify('SUCCESS') } }
        }
        failure {
            script { if (lib) { lib.notify('FAILURE') } }
        }
        unstable {
            script { if (lib) { lib.notify('UNSTABLE') } }
        }
        aborted {
            script { if (lib) { lib.notify('ABORTED') } }
        }
    }
}
