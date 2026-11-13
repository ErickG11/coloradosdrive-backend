# Continuación F44/F45 (cierre pre-migración)

Autorización vigente: adjunto b3ec9557-eb2d-44da-adda-f78296b6c3e7. Una sesión, sin
subagentes. Sin push/SQL remoto/.env/secretos/tokens/globals/compartidos. Excepción
puntual: solo arnés PostgreSQL embebido F45 (también055/056 si se crean), no otras suites.
Orden F44-a → F44-b → F45 → F44-c → F44-d → F44-e. F43/F23 siguen pendientes.

- F44-a 6f741f1: frontera de salida en errorHandler, códigos de identidad solo admin;
  rastreo no halló una ruta pública actual que origine esos cuatro, defensa adicional
  genérica por si llegan. Catálogo inscripcion-codigos-error-admin.md. Typecheck/lint OK.
- F44-b 14c0ec8: Nodemailer10.3.1 exacto + correcciones compatibles sin --force del lockfile.
  Adaptación console a listas anidadas (acotada/sin recursión). GitHub/Jenkins auditoría
  bloqueante. Auditoría producción exit0: 0high/0critical/3moderate. Node local24 vsCI22.
  Typecheck y lint correo OK. Sin pruebas de envío; revisión de imports/compatibilidad.
- F45 0ece391 CERRADA: tests/migrations/checkEnrollmentMigrations.ts (standalone, no Jest) y
  extensión snapshot del helper EmbeddedPostgres. Aplica001..054 incluyendo003; pgcrypto
  omitido porque gen_random_uuid ya es nativo en PGlite, btree_gist real. Auth/Storage/
  Realtime se simulan localmente. Cada preflight/verificación/rollback se ejecuta en
  copia restaurada de snapshot de su etapa, sin alterar la secuencia principal.
  Resultado preliminar /tmp/f45-run.log y reporte /tmp/inscripcion-f45.json.
- F45 final:54 aplicaciones/32 preflights/25 verificaciones/35 rollbacks OK; no cambios
  a SQL042–054. Único ajuste de entorno: SELECTstorage.objects para service_role en
  bootstrap simulado; se repitió001–054 completo. pgcrypto no distribuida, gen_random_uuid
  nativo; Auth/Storage/Realtime simulados, no prueba de red/multiconexión. N/D es script
  histórico no existente, no prueba pasada. Tabla en inscripcion-orden-migraciones.md.
- Typecheck fuente y específico del arnés, lint de archivos tocados y build backend OK.
  Auditoría producción exit0:0altas/0críticas/3moderadas. Logs /tmp/f44a-*, /tmp/f44b-*,
  /tmp/f45-*, /tmp/inscripcion-f45.json, /tmp/f44-f45-build.log. Solo arnés F45 ejecutado.
- CORTE POR CONTEXTO. Pendientes F44-c (recuperación cron), F44-d (override admin),
  F44-e (mensajes públicos/admin y botón en Alumnos). NO se implementaron ni se crearon
  migraciones055/056. Frontend sin cambios, por eso no se construyó en esta tanda.
- Continuar por F44-c con autorización ya dada; luego d/e. No iniciar F43 ni F23.
  Todas las notas/progreso siguen SIN commit. No hubo push, SQL real ni cambios a.env.


## Lectura inicial de F44-c y precaución para continuar

- F16 actual no tiene recuperación programada: AccountService crea Auth entre reclamar
  y finalizar; si proceso muere antes de guardar el UUID solo queda reviewed_by/at.
  Al liberar, evitar perder una cuenta que ya se creó y no borrar una cuenta existente
  de otra vía por mera coincidencia de correo. Un resultado de red incierto no autoriza
  borrar una cuenta potencialmente aprobada (UncertainApproval ya protege ese caso).
- solicitudApproval.service.ts contiene aprobar/finalizar/validarRequisitos; SQL052
  reclamar_aprobacion_inscripcion/finalizar_aprobacion_inscripcion; SupabaseAdmin se
  construye en config/supabase.ts. Leer solo lo que se vaya a modificar.
- Para recuperación segura de nuevas aprobaciones, considerar intención durable antes
  de createUser (UUID/correlación técnica en app_metadata) y CAS/lease de recuperación;
  no hay diseño ni SQL055 implementado todavía. La compensación de F16 no debe borrar
  Auth si un trabajo tomó la reclamación o confirmó la aprobación entre tanto.
- Probar055/056 exclusivamente con el arnés F45 (MIGRATIONS_THROUGH=055/056); añadir
  sus scripts/tables a la tabla. No reutilizar los números042–054 para esas tareas.


## F44-c implementada (pendiente registrar hashes)
- 055: intención durable antes de Auth; UUID y marcas app_metadata; guard atómico
  impide finalizar un intento tomado por recuperación. Lease/CAS; cuentas aprobadas
  o con perfil quedan protegidas; cuentas ajenas no se eliminan por correo.
- Cron cada5min America/Guayaquil, TTL configurable10min, lotes acotados, compensación
  estricta con reintento, revisita intenciones compensadas por posibles Auth tardíos.
  Legacy sin Auth se libera; legacy con cuenta requiere reconciliación manual auditada.
- Typecheck fuente y lint tocado OK; arnés001–055 y scripts055 OK. Sin otras pruebas.
- Continúa F44-d (056), luego F44-e. Sin SQL remoto/.env/push.


## Continuación F44-c/d
- F44-c cerrada: bb84923 SQL055 +91abf31 runtime/cron. Typecheck/lint OK.
- F44-d implementada: SQL056, override admin autenticado/MFA + comprobación admin
  activo SQL; matrícula más reciente origen solicitud, exige práctica con plazo48h
  vencido. Conserva primera confirmación, certificado original intacto, motivo
  normalizado10–300 en auditoría append-only privada. GET detalle expone estado.
- Typecheck/lint tocado OK. Arnés001–056 y scripts056 OK; ningún SQL042–054 cambiado.
 56 aplicaciones/34 preflights/27 verificaciones/37 rollbacks OK. Sin otras pruebas.
- Sigue F44-e. SQL055/056 pendiente manual; no SQL remoto, push ni cambio.env.


## F44-d cerrada; F44-e validando build final
- Backend F44-d:93ee1bb SQL056 +dfc6aac endpoint/GET/errores/contrato. Typecheck/lint
  tocado y build backend OK. F44-c:bb84923 +91abf31, igualmente validados.
- F44-e frontend: mensajes admin exactos para cuatro códigos; público usa mensaje
  único y oculta field para ellos. Botón condicionado por origen/no confirmada;
  modal Input10–300 normalizados, contador, exclusión de doble envío, timeout y
  recarga obligatoria tras resultado incierto. Toast verde y refetch de ficha/lista.
- Typecheck aplicación (tsconfig temporal en /tmp excluyendo tests) y lint tocado OK.
  Global tsc:9 errores previos en tests/components/solicitudes-admin (props antiguas
  de SolicitudDetail, DocumentViewer/ReviewActions eliminados); no se tocaron tests.
- Build frontend habitual: descarga de fuentes bloqueada en sandbox; reintento con
  red compila pero falla por esos9 errores de tests. Build de aplicación con webpack,
  variables públicas ficticias y exclusión temporal de tests compila, chequea tipos
  y genera32 páginas; tsconfig.json se restaura byte a byte. Config/tests no cambiados.
  Se está repitiendo tras el último ajuste de accesibilidad del modal.
- No se ejecutó ninguna suite, solo excepción SQL F45 (001–056). Sin SQL remoto,
  secretos, .env, compartidos/globals/tokens ni push. F23/F43 siguen aplazadas.


## Cierre F44-c/d/e (2026-11-03)
- F44-c: bb84923 +91abf31. F44-d:93ee1bb +dfc6aac. F44-e:d73b3e3 (frontend), mensajes y confirmación manual en Alumnos.
- Build final backend OK. Build final frontend aplicación OK (webpack, tipos activos,
 32 páginas) tras último ajuste de IDs del modal; tsconfig restaurado, sin diff.
- Typecheck aplicación/lint de archivos tocados OK por tarea. Global frontend sigue
  con9 errores previos solo en tests; no se arreglaron por prohibición de tocarlos.
  Logs /tmp/f44c-*, /tmp/f44d-*, /tmp/f44e-*, /tmp/f44-final-backend-build.log.
- 055/056 quedan para aplicación MANUAL; F45 local001–056:56/34/27/37 OK.
  Sin otras pruebas. No cambios a042–054, .env, secretos, estilos/compartidos ni push.
- No quedan F44-c/d/e pendientes de implementación. Legacy con Auth sin correlación
  requiere revisión manual segura (runbook055); nuevas aprobaciones sí recuperables.
- Próxima acción: operador aplica055/056 según runbooks y comprueba flujos reales.
  Fase final de pruebas/F23 y F43 solo al pedirlo explícitamente. Deuda detallada
  en inscripcion-pruebas-pendientes.md. Progreso/deuda conservados SIN commit.
