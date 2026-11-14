# Continuidad del flujo final F01–F43 (F43 solo con petición explícita)

Brief vigente: `docs/operations/inscripcion-brief.md` (ya versionado),
con las precisiones **autorizadas** de F02 del mensaje siguiente. No volver a pedir
confirmación: authenticated conserva EXECUTE solo en los dos helpers privados de
Broadcast y USAGE de private; anon ninguno; excluir extensiones por pg_depend/e.

Repos y ramas:
- Backend: feat/inscripcion-en-linea.
- Frontend: feat/inscripcion-en-linea-ui (sin cambios en esta tanda).

No aplicar SQL ni consultar Supabase, iniciar servidores, ejecutar test:*-db,
editar .env, push/pull/merge o cambiar identidad Git. No delegar a subagentes.
Completar por fases sin confirmaciones. Cada tarea 1–3 commits, última línea
`Tarea: Fxx · Historia: Hn`. SQL en su propio commit. No tocar tesis ni wizard manual.

## Corte por contexto después de F11

| Tarea | Historia | Commit | Resultado |
| --- | --- | --- | --- |
| F01 | H4 | 83fb6ab | Modelo final SQL 042, reconciliación, scripts manuales y 31 pruebas |
| F02 | H4 | d62363b | Endurecimiento SQL 043, excepciones autorizadas, scripts y 15 pruebas |
| F03 | H4 | c1a7e59 | Configuración/catálogos tipados, ejemplos ficticios y 28 pruebas |
| F04 | H4 | 02ab3ef | Saneamiento, comparación de correo, desechables, campos conocidos y 35 pruebas |
| F05 | H1 | 6a2f4b6 | Validadores puros del contrato final y 63 pruebas |
| F06 | H4 | 36bff59 | Captcha conectado a ruta real, guardas de arranque y 34 pruebas |
| F07 | H4 | 79c3a18 + 321ff86 | SQL044 y límites persistentes conectados a rutas |
| F08 | H4 | 83dfa5e | Respuesta uniforme con piso de 300 ms |
| F09 | H1 | 57be53f + cf87f77 | SQL045 OTP atómico, scopes, autorización por estado y progreso ampliado |

Siguiente tarea **F12**, luego F13–F42 en orden. F43 espera petición explícita.
No hay bloqueo ni pregunta pendiente.
F42 sí es necesaria: solo smtp/console, no existe gmail_api.

## Comprobaciones al corte

Backend:
- Base antes de F01: 80 suites / 1.147 pruebas.
- Tras F01: 81 / 1.178.
- Tras F02: 82 / 1.193.
- Tras F03: 84 / 1.221.
- Tras F04: 85 / 1.256.
- Tras F05: 86 / 1.319.
- Tras F06: **89 suites / 1.353 pruebas**, todas pasan.
- Build y typecheck de fuente/tests (tests: `--rootDir .`) correctos; lint sin errores/advertencias.
- Advertencia preexistente ts-jest TS151002 en salida, no se cambió configuración general.

Frontend: **98 archivos / 809 pruebas**, typecheck y lint correctos, sin cambios.
No se eliminaron pruebas. Frente a cifras del brief 1.076/759: +277/+50;
la base previa ya tenía +71/+50, estas tareas suman 206 pruebas backend.
No existe todavía la suite tests/security F23; no afirmar cobertura completa S1–S16.
Hay pruebas de seguridad distribuidas en las suites nuevas (en particular 15 de
permisos F02 y 34 de captcha F06), sin clasificarlas como suite F23 ya entregada.

Logs: /tmp/f02-full.log, f03-full.log, f04-full.log, f05-full.log, f06-full.log;
f06-build.log, f06-type.log, f06-lint.log; fase1-frontend-full.log,
fase1-frontend-type.log, fase1-frontend-lint.log. Node local 24.20.0, runtime repo22.

## SQL preparado, NO aplicado

042 y 043 con preflight, verificación que termina ROLLBACK y rollback en
`docs/operations/`. No aplicar ni desplegar aisladamente con backend viejo.
F01 cambia estados: rutas/servicios antiguos aún usan pendiente_revision y cuatro
ranuras; se adaptarán en F09–F20. No se presume flujo final desplegable.

F02 probado con TODAS las migraciones reales 001–042 en PostgreSQL embebido,
excepto seed003 y el CREATE pgcrypto (gen_random_uuid nativo); btree_gist real.
Hilo Node en `tests/helpers/embeddedPostgres.ts` evita problema de ESM/WASM en VM
Jest29, sin flags, dependencias nuevas, red, servidores ni credenciales.

F02:
- Conserva los dos helpers y políticas existentes; tests de rol real para alumno,
  instructor y tercero; suscripción de red pendiente de la prueba manual en
  inscripcion-043.md.
- Excluye funciones de extensiones por dependencia y compara sus ACL exactos.
- REVOKE tablas también PUBLIC y grants por columna; funciones propias también
  coloradosdrive_private. service_role conserva EXECUTE para no romper backend.
- Defaults de postgres en public, más retirar EXECUTE global de PUBLIC para
  funciones futuras: un REVOKE por esquema no puede anular ese default implícito.
  No cambia funciones existentes en otros esquemas. Justificado con documentación
  PostgreSQL y ensayo de creación real de objetos futuros.
- Preflight falla ante defaults globales explícitos a roles API fuera del caso
  implícito anterior, en vez de alterar unilateralmente otros esquemas.
- Backup ACL solo metadata, RLS/no políticas, sin acceso API, rollback exacto.
- set_updated_at search_path vacío; las otras dos mantienen search_path porque
  usan tipos/tablas sin esquema (ver docs).
- Única escritura storage: límite 2MiB y MIME JPEG/PDF del bucket.

## Código base terminado y conexiones pendientes

F03 `enrollmentCatalog.ts` y `enrollmentConfig.ts`:
- Catálogos de nivel/sangre/nacionalidad/métodos/motivos y mensajes/checklist.
- revision_visual nunca habilita; web_service previsto, fuera de métodos manuales.
- ENROLLMENT_* topes con defaults y enteros/0, MFA false, versiones configurables.
- HMAC puede usar secreto dedicado; F07 DEBE derivar contexto independiente si usa
  SOLICITUD_TOKEN_SECRET como fallback (no usar la clave cruda indistintamente).

F04 `enrollmentSanitization.ts`:
- NFC/espacios, quita Cc/Cf, correo IDNA, conserva destino y crea comparación Gmail.
- normalizeEmail existente delega a esta utilidad; findByCorreo aún no usa la clave
  canónica hasta F09. SQL normaliza correo ya saneado de entrega.
- Lista de desechables local, exacta/subdominio; no sufijos parecidos, no red.
- requireKnownFields listo para rechazar unknown fields del contrato nuevo.

F05 `enrollmentValidation.ts`:
- Datos nuevos, nombres/apellidos 2–60, edad según curso, representante, códigos,
  niveles/subtipos, decisiones/mensajes/nota y verificaciones.
- Cédula reutiliza cedula.ts, no duplica algoritmo.
- Validadores nuevos todavía NO sustituyen rutas con contrato viejo; conectar en
  F09–F15. nombreCompleto siempre derivado; no aceptarlo como input nuevo.
- PUT datos permite nivelEstudios opcional para guardarlo en el paso siguiente;
  enviar F13 exigirá datos y nivel completos.
- Aprobar no inventa motivo: no hay código de aprobación definido. Motivo nulo;
  devolver/rechazar requieren catálogo; OTRO mensaje10–300, VENCIDA solo job.

F06 ACTIVO en backend:
- env valida off prohibido production, ambas claves obligatorias con turnstile,
  dummy oficiales prohibidas en producción. tests/setupEnv fuerza off y valores
  ficticios; smoke SMTP producción usa turnstile con claves ficticias de test.
- CaptchaService.verify: POST fijo Siteverify, secret/response/remoteip, timeout5s,
  redirect:error, jamás logs de proveedor. 400 CAPTCHA_INVALIDO, 503
  VERIFICACION_NO_DISPONIBLE ante caída/HTTP/malformado/errores servidor.
- hostname exacto contra FRONTEND_URL en producción; dummy local permitido.
- Ruta real: límite IP antiguo -> captcha -> límite correo antiguo -> validaciones
  -> controller. Test confirma que fallo no alcanza servicio/DB/correo.
- Widget y cliente frontend pendientes F27; local off sigue funcionando.
- Claves públicas oficiales de prueba SOLO en documentación, no credenciales.

## Decisiones/riesgos que conservar

- No dividir nombres legacy ni convertir títulos viejos automáticamente.
- titulo_bachiller conserva nombre de checklist físico para no tocar wizard.
- Verificaciones sin FK al expediente como auditoría; notas técnicas sin PII.
  Revisar retención de notas en F20, no prometer detección automática de PII.
- Los errores/modelos/rutas antiguos requieren sustitución, el flujo no está listo
  para despliegue. Mantener documentación de fase vs comportamiento real.
- TRUST_PROXY_HOPS aún default viejo1: F07 debe cambiar a 0 desarrollo /1 production.
- Retención, scopes JWT, MFA, auth settings, pipeline archivo seguro, correo de
  acceso sin contraseña, CI y todo frontend final siguen PENDIENTES.

Este archivo de continuidad se deja **sin commit**, como pide el brief.

## F07 completada en la continuación

- 79c3a18 feat(inscripcion): prepara reservas atómicas de límites y configuración (SQL044).
- 321ff86 feat(inscripcion): aplica límites HMAC y expone configuración operativa.
- 11 archivos de pruebas afectados /125 pruebas correctas, build y typecheck/lint correctos.
- SQL044 no aplicado, con preflight/verificación/rollback; preserva datos al revertir.
- Activos límites persistentes de código/IP, configuración pública/admin y resumen con alertas80%.
- Métodos/RPC para nueva solicitud, fallos diarios y subida listos y probados; integrar al
  sustituir verificación/confirmación en F09 y antes de Multer en F12. No afirmar flujo desplegable.
- TRUST_PROXY_HOPS corregido: 0 local/test, 1 producción.
- docs/operations/inscripcion-brief.md faltaba; se recuperó el brief maestro del adjunto
  autorizado registrado. Mantener precisiones F02 del usuario por encima del texto antiguo.

## F08 completada / cierre de fase 2

- 83dfa5e fix(inscripcion): uniforma respuestas y aplica piso temporal de verificación.
- 6 suites afectadas /59 pruebas correctas; helper de reloj monotónico y HTTP sobre
  servicio real con DB/correo simulados (nuevo, existente, cuenta y error BD).
- Curso inexistente en HTTP ahora devuelve mismo éxito200 sin correo; test previo
  adaptado a S1, ninguna prueba eliminada. La validación sintáctica previa sigue4xx
  sin consultar identidad. Bloqueo spam se conectará en F09, no afirmar que ya se emite/deniega por estado.
- Guarda piso300ms, nunca demora adicional si trabajo supera300ms; errores internos
  se enmascaran y loguean solo verification_request_failed. Cierre/cupos/captcha
  e indisponibilidad de comprobación de seguridad mantienen códigos controlados.
- Brief maestro recuperado del adjunto y versionado en docs/operations/inscripcion-brief.md
  con aclaraciones F02 anexas. Ya no depende del archivo externo.
- Cierre completo de fase2: backend95 suites /1.404 pruebas; frontend98 archivos /809.
  Build backend, typecheck fuente/tests y lint ambos correctos. Logs /tmp/fase2-*.log
  y /tmp/f08-{tests,build,type,lint}.log. Frontend sin cambios, rama solicitada limpia.
- F07 suma38 casos nuevos, F08 suma13; no se eliminaron casos previos. Frente al
  brief original1076/759, el total es +328/+50. Suite F23 aún pendiente.
- Se detiene por contexto después de terminar/commitear F08; no hay contradicción
  ni permiso pendiente. Continuar directamente F09. No releer módulos conocidos;
  por tarea tests afectados +typecheck/lint; suites completas al cerrar fase3.

### Integraciones previstas para F09 (histórico, completadas abajo)

1. Usar correo_normalizado y correo_bloqueado (HMAC), respetar cuenta sin solicitud
   vs solicitud vinculada en todos los estados. No crear otra rechazada.
2. Usar EnrollmentLimitsService.createDraft() /RPC crear_borrador_limitado de044
   en lugar de INSERT para reserva de nuevas solicitudes; no reservar presupuesto
   aparte porque pierde atomicidad. Cuota de códigos/IP ya está en middleware real.
3. Registrar fallos diarios con recordFailedCode al confirmar; coordinar con consumo
   CAS/SQL para no contar doble en reintentos concurrentes. El RPC general de límite
   ya serializa clave/tipo; la confirmación actual sigue CAS antiguo/max5 por código.
4. JWT con scope edicion (borrador/devuelta) o estado (resto), aud/iss/exp1h, y
   autenticarSolicitud valida estado actual de cada petición. Ese cambio agrega
   consultas en middleware: adaptar fixtures/tests anteriores de rutas sin saltar
   comprobaciones reales de autorización.
5. Ampliar progreso con estado/curso/nivel/flags/devolución sin nota interna. Edad
   por curso; consentimiento/términos en F10 y datos nuevos en F11.
6. SQL nuevo siempre en commit aparte +preflight/verificación ROLLBACK/rollback,
   repetir grants explícitos a service_role tras defaults de043.

### F07 detalles para reutilizar

- EnrollmentLimitsService: reserveCodeIp, reserveCode, recordFailedCode, reserveUpload,
  createDraft, settings, updateSettings, publicConfig, summary.
- enrollmentRateKey usa express-rate-limit.ipKeyGenerator IPv6/64 con conversión
  IPv4 mapeada, HMAC derivada de contexto separado. Sin IP válida usa grupo común.
- SQL044: reservar_limite_inscripcion, crear_borrador_limitado,
  actualizar_config_inscripcion y nuevo resumen_solicitudes.
- Rate eventos con tipo+hash y advisory_xact_lock; código correo por día local+cooldown,
  IP por hora móvil, fallos10/día y subidas5/IP/día. Globals usan consumir_cupo042.
- Topes ENV agregados ENROLLMENT_CODES_PER_EMAIL_DAILY_CAP=5,
  ENROLLMENT_FAILED_CODES_PER_EMAIL_DAILY_CAP=10, ENROLLMENT_CODE_COOLDOWN_SECONDS=60.
- Fallback de subida marca flag solo en borrador/devuelta, correo verificado y nivel
  obligatorio; F12 debe llamar reserveUpload antes de Multer y F13 permitir envío.
- Config auditada en solicitud_auditoria usa UUID cero como marcador global.
- Resumen ahora incluye cupoSolicitudesHoy además de los dos cupos pedidos y alertas
  de los tres al80%. Contadores documentales eliminados de respuesta, filtro/lista
  legacy aún se sustituirá en las tareas admin.
- Middleware persistente de códigos NO salta NODE_ENV=test; tres suites anteriores
  (solicitudes, consoleEmail, captcha) lo mockean explícitamente para aislar correo;
  tests/integration/enrollmentConfig.test.ts ejercita gate real contra RPC simulado,
  tests/unit/enrollmentLimitsSql.test.ts ensaya SQL real embebido.

## Cambio de alcance autorizado: F43 aplazada

- F06 backend y sus pruebas/guardas se conservan intactos. off solo desarrollo/test;
  producción sigue negándose a arrancar con off. captchaToken opcional/ignorado en off.
- Frontend no carga script, exige ni envía token hasta autorización expresa de F43.
- F27 implementará correo/código y CaptchaSlot vacío documentado, sin widget.
- Nueva F43 H4 al FINAL: widget, caducidad/reintento/fallo, script solo paso correo,
  CSP correspondiente, variables/claves de prueba y pasos manuales/documentación.
  NO ejecutar F43 automáticamente: solo petición explícita. Requisito de producción.
- ADR defensa contra abuso debe registrar literalmente riesgo residual:
  "hasta F43, los límites por correo e IP y los topes diarios son la única barrera contra bots".


## Cierre F09

- 57be53f `feat(inscripcion): serializa la emisión y el consumo de códigos`.
  Solo SQL045, sus scripts preflight/verificación/rollback, documentación y prueba SQL.
- cf87f77 `feat(inscripcion): limita las sesiones y amplía el progreso de la solicitud`.
  Integración runtime, JWT, autorización, progreso, tests y alcance F43 en brief.
- **14 suites /171 pruebas afectadas pasan**. Build backend, lint y typecheck de
  fuente/tests (`npm exec tsc -- --noEmit -p tsconfig.eslint.json --rootDir .`) correctos.
  Logs `/tmp/f09-tests.log`, `/tmp/f09-build.log`, `/tmp/f09-type.log`, `/tmp/f09-lint.log`.
  Sin suite completa en F09: fase3 sigue abierta hasta F22; último cierre completo
  fase2 backend95/1404 y frontend98/809. Frontend sin cambios y rama limpia.
- Emisión serializada por correo canónico: reutiliza cualquier estado sin modificar
  datos/curso/fechas/dirección original; cuenta sin solicitud y spam no emiten.
  Crear borrador y reservar presupuesto siguen en la misma transacción de044.
- Confirmación serializada con consumo único y auditoría. Fallos diarios incluyen
  desconocidos/vencidos y no se duplican por CAS; max5 por código anterior sustituido
  por10/día canónico del brief. Reenviar no reinicia contador. Límite persistido HMAC.
- JWT HS256 fija aud/iss, scope y exp1h. Borrador/devuelta edicion; resto estado.
  Middleware consulta correo verificado/estado en cada petición y rechaza escritura
  con scope estado o token antiguo tras transición. Tokens legacy requieren verificar
  correo otra vez. No-store incluso en errores de autorización.
- Progreso expone curso/edad, estado explícito, pasos, datos propios para reanudar,
  devolución pública, nivel y flags del certificado; nunca notas internas/rutas.
  Solo certificado_estudios aparece entre documentos. Campo puedeEditar combina
  estado actual con scope del token. Cuerpos públicos rechazan campos protegidos.
- Los fixtures HTTP legacy aíslan únicamente la nueva consulta de estado del
  middleware usando createSolicitudAuth real: NO evitan firma ni scope. Matriz nueva
  en solicitudScope prueba estado persistido y cambios; SQL embebido prueba estados,
  cuentas, alias, spam, presupuestos, consumo repetido/fallos Promise.all y rollback.
  PostgreSQL embebido serializa conexiones; no afirmar prueba multiconexión remota.
- Diferencias: S3 reemplaza antiguo bloqueo al quinto intento por límite diario10;
  progreso deja de derivar borrador/enviada de pendiente_revision y usa estado SQL042.
  Tipos aún admiten pendiente_revision/documentos legacy para no mezclar F11–F15;
  middleware público lo rechaza. Rutas de datos/envío/decisión aún legacy, pendientes.
- SQL045 **NO aplicada**. No consultas remotas, test:*-db, servidores, .env, push ni
  cambios de identidad. docs/operations/inscripcion-progreso.md sigue SIN commit.
- Corte por contexto tras terminar y commitear F09. Continuar F10: consentimiento y
  términos versionados H4, con pruebas afectadas +build/typecheck/lint. No releer
  módulos conocidos salvo los que se vayan a modificar. No ejecutar F43.


## Método vigente autorizado: sin pruebas hasta petición explícita

- No crear, modificar ni borrar tests; no ejecutar suites completas/parciales ni SQL
  de prueba. F23 y la corrección/ejecución de tests quedan para la FASE FINAL DE
  PRUEBAS que pedirá expresamente el usuario. Este bloque sustituye reglas previas.
- Por tarea: typecheck global de fuente, lint de archivos tocados y autorrevisión
  contra el brief/S1–S16. Compilación sin emitir con tsc; al cerrar cada fase, build
  de backend y frontend. No afirmar pruebas como pasadas sin haberlas ejecutado.
- Registrar casos concretos en docs/operations/inscripcion-pruebas-pendientes.md,
  SIN commit; actualizar también este progreso SIN commit al cerrar cada tarea.
- Siguen vigentes no .env/no SQL remoto/no servidores/no push/no delegación y F43
  aplazada hasta petición explícita. No se ha autorizado producción.


## Cierre F10 (método sin pruebas)

- fb46513 `feat(inscripcion): prepara el consentimiento atómico por aviso y términos`.
- 6564b7f `feat(inscripcion): exige términos vigentes y publica el aviso de privacidad`.
- Aviso/términos en texto plano BORRADOR/en revisión legal, salud/retención/derechos;
  reembolso configurable, reglas de prácticas limitadas a las existentes. Versiones
  1–100 caracteres; default aviso nuevo 2026-11-borrador-v1. .env intacto.
- Consentimiento exige ambas versiones y tres booleanos true; sin campos extra.
  RPC de servicio con lock de solicitud, solo borrador/devuelta, correo verificado,
  idempotente por pareja de versiones, fecha original preservada y auditoría sin PII.
- Añade autorización de tratamiento del representante independiente de sus datos;
  conserva CHECK original de identidad del representante. F11 completa sus datos.
- Rollback aborta sin cambios si restaurar UNIQUE antigua borraría evidencia de varios
  términos; documentación046 explica la limitación. SQL no aplicado ni ejecutado.
- Typecheck global de fuente tsc --noEmit y lint de archivos tocados pasan. Autorrevisión
  S5/S7/S8/S9/S11/S16 registrada en docs046. No se crearon/tocaron/ejecutaron tests.
  Deuda detallada F10 en inscripcion-pruebas-pendientes.md, SIN commit. Fase3 abierta:
  builds de ambos repos al terminar F22; ninguna suite antes de petición explícita.


## Cierre F11 (método sin pruebas)

- 2e2ad8a `feat(inscripcion): prepara el guardado atómico de datos y representante` (SQL047).
- b84e75a `feat(inscripcion): valida los datos por curso y protege la identidad duplicada`.
- Ruta datos usa validadores F05, datos separados, sangre/nacionalidad/nivel, teléfono
  opcional normalizado, edad del curso y representante de menores. Cuerpo desconocido
  se rechaza, nombreCompleto derivado por trigger, correo/curso/fechas preservados.
- Guardado y representante en RPC transaccional, correo verificado/estado editable,
  consentimiento de ambas versiones, curso bloqueado y edad revalidada en SQL.
  Devuelta conserva enviada_at y permite corrección. Token devuelto de edición 1h.
- Duplicados users/solicitud activa e índice: DATOS_NO_REGISTRADOS + mensaje genérico.
  Se conserva predicado042 (borradores NO reservan cédula); F13/F15 revalidan al
  enviar/aprobar y comparten lock cedula_inscripcion:<cedula>. Manual intacto.
- Marca datos_actualizados_at cambia solo ante cambio real o primer guardado; F14/F15
  DEBEN comparar frescura de verificaciones. Cambio de nivel limpia flag por cupo;
  F12 DEBE comprobar compatibilidad de certificado/subtipo con nivel vigente.
- Progreso permite reanudar representante propio, sin notas ni rutas. Se conservan
  versiones/datos históricos de consentimiento; autorización de tratamiento del
  representante se guarda con sus datos en la misma transacción.
- Typecheck global de fuente y lint de los7 archivos fuente tocados pasan. Autorrevisión
  S1/S5/S7/S8/S9/S10/S11/S16 en docs047. Tests intactos, NO ejecutados; casos F11
  registrados sin commit en inscripcion-pruebas-pendientes.md. SQL047 NO aplicado.
- Para F13: middleware F09 bloquea POST con estado enviada; adaptar SOLO enviar/reenviar
  para devolver idempotencia con token de edición anterior, sin permitir otras
  escrituras ni tokens scope estado. Las demás guardas deben conservarse.


## Cierre F12 (pruebas reactivadas por instrucción del usuario)

- Método: el usuario pidió en la sesión nueva correr por tarea las pruebas de los archivos
  afectados + typecheck + lint (sustituye el bloque «sin pruebas»); suite completa al cerrar
  fase y al final. Se permiten subagentes. Sin push/pull/merge, sin SQL remoto, sin servidores.
- db28cd2 `feat(inscripcion): prepara el guardado atómico del certificado de estudios` (SQL048
  guardar_certificado_inscripcion, preflight/verificación ROLLBACK/rollback, 7 pruebas PGlite).
- 09d34ea `feat(inscripcion): valida y guarda el certificado de estudios con pipeline seguro`.
  sharp 0.35.5 (autorizada). Archivos: utils/{certificateFile,pdfInspection,processingGate},
  middlewares/uploadCertificado, services/solicitudCertificateStorage, reserveEnrollmentUpload
  antes de Multer, mensaje propio de tope de subidas (continuar sin archivo), SI433/SI434.
  Contrato: multipart `archivo` + `subtipo`; sin `tipo_documento`.
- Pruebas F12 nuevas: certificateFile 20, pdfInspection 16, processingGate 3, servicio 18,
  ruta HTTP 15, SQL 7, limits +2 = 81. Eliminadas 13 del bloque antiguo «POST
  /solicitudes/:id/documentos» de solicitudes.test.ts (contrato de 4 ranuras/5 MB, reemplazado).
- Mocks de enrollmentLimits.middleware en 4 suites ampliados con reserveEnrollmentUpload.
- **Fallas PREEXISTENTES en HEAD b84e75a** (verificado con git stash, no causadas por F12):
  solicitudSubmission (5), solicitudesAdmin (6, aprobación), consoleEmail (1, contraseña por
  correo). Son contratos antiguos de enviar/aprobar → se reescriben en F13, F15, F16.
  Suite completa pendiente hasta cerrar fase 3.
- PDF: inspección estática (falla cerrado ante ObjStm no inflable/otros filtros, /Encrypt);
  bytes de flujos no se examinan (evita falsos positivos). No sustituye antivirus.
- Para F13: enviar debe permitir envío sin archivo si documento_estudios_pendiente_por_cupo=true
  y exigir certificado si nivel obligatorio y no hay flag; bachiller/reciente sin archivo ok.
  Comparar frescura: datos_actualizados_at y uploaded_at del certificado (F14/F15 verificaciones).
- legacy: uploadDocumento (middlewares/upload.ts) y SolicitudDocumentStorage siguen solo para la
  ruta del alumno con cuenta (estudiante.routes/studentDocuments) hasta F18.
- archivo_verificado_at se reinicia al reemplazar; F14/F20 deben fijarlo al verificar estudios.

## Cierre F13

- 7b0baed `feat(inscripcion): prepara el envío y reenvío atómicos e idempotentes` (SQL049
  enviar_solicitud_inscripcion(id,modo,aviso,términos) → {id,estado,enviadaAt,transicion};
  preflight/verificación ROLLBACK/rollback; 12 pruebas PGlite). SQL049 NO aplicado.
- f48af38 `feat(inscripcion): envía y reenvía solicitudes con transición idempotente y acuse`.
  POST /:id/enviar y /:id/reenviar; correo de recibida solo si transicion=true, sin PII, un
  fallo de correo se registra como received_email_failed y no deshace. Middleware
  solicitudAuth: POST enviar|reenviar sobre «enviada» pasa con scope edicion (idempotencia);
  resto de escrituras sigue 409. SI435→ESTADO_INCORRECTO; SI424 faltantes admite certificado_estudios.
- Pruebas F13: solicitudEnvioSql 12, solicitudEnviar (unit) 16, solicitudSubmission (HTTP) 12
  (reescritas; sustituyen 8 del contrato de dos documentos), solicitudScope +4. Typecheck+lint ok.
- RPC legacy enviar_solicitud (040) queda sin uso; no se borra.
- Reenviar conserva enviada_at original. Verificaciones F14/F15 deben comparar contra
  datos_actualizados_at y uploaded_at/archivo_verificado_at del certificado.

## Deuda de pruebas heredada (detectada al reactivar pruebas; NO causada por F12/F13)

Verificado contra b84e75a con un worktree temporal (ya eliminado):
- tests/integration/solicitudes.test.ts NO compilaba en b84e75a (mock de requireConsent sin
  campos de F10). Al retirar el bloque de documentos antiguo compila, pero quedan 3 pruebas
  de PUT /solicitudes/:id/datos con el contrato anterior a F11 (cédula+nombreCompleto):
  «exige token y valida cédula…», «rechaza ausencia de consentimiento», «guarda datos y
  conserva la primera fecha…». Reescribir al contrato F11 (cierre de fase 3).
- solicitudesAdmin (6, aprobación) y consoleEmail (1, contraseña por correo): contratos de
  aprobación antiguos → se reescriben en F15/F16.
- Mocks de enrollmentLimits.middleware en las suites que lo simulan deben incluir
  reserveEnrollmentUpload (ya añadido en captcha, consoleEmail, uniformVerification, solicitudes).
- No se ha corrido la suite completa desde cierre de fase 2 (95 suites / 1.404 pruebas);
  correrla al cerrar la fase 3 (después de F22) y reportar cifras antes/después.

### Punto de continuación: F14 (verificaciones del admin append-only + URL firmada auditada), sin cambios aún
- Tabla solicitud_verificaciones (042) y trigger append-only ya existen; falta RPC de inserción
  validando tipo/método/resultado con las listas de enrollmentCatalog (identidad solo
  registro_civil_*; estudios según nivel; revision_visual nunca habilita), estado enviada,
  freshness. Ruta GET /admin/solicitudes/:id/certificado/url (300 s, attachment, auditada)
  reutilizando solicitudAudit.service/SolicitudDocumentAccessService. Validadores F05 ya listos.
- Sin push/pull/merge, sin SQL remoto, sin servidores, sin test:*-db. F43 no se toca.


## Corte más reciente: F44-a/F44-b/F45 (2026-11-03)

Estado vigente en inscripcion-progreso-f44-f45.md: commits6f741f1,14c0ec8 y0ece391.
Recorrido embebido001–054 completo sin errores; SQL real intacto. Pendientes por
contexto F44-c/d/e (autorizadas, en ese orden). Frontend sin cambios. No F43/F23.


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


## F46 — entorno local preparado, DETENIDO por sandbox (2026-11-03)
- Usuario autoriza solo F46: editar.env backend solo faltantes y arrancar servidores;
  no suites, ni SQL Supabase, ni push. Ante bloqueo de red/puerto exige DETENERSE.
- Git055: único commit bb84923 2026-11-03T23:25:36-05:00; diff desde91abf31
  (último commit anterior a23:30) vacío. No cambió055 ni scripts; no delta ni arnés.
  Usuario declara055 aplicada manualmente23:30; no se consultó estado remoto.
- Git056: único93ee1bb 23:30:30-05:00; sin cambios posteriores. Sigue pendiente
  según último progreso, sin comprobación SQL remota de aplicación.
- .env ignorado por git: añadidos únicamente EMAIL_PROVIDER,CAPTCHA_PROVIDER,
  TRUST_PROXY_HOPS,ADMIN_MFA_REQUIRED,ENROLLMENT_RATE_HMAC_SECRET. HMAC generado
  directamente con openssl rand -hex32 sin imprimirlo. Todas las variables existentes
  preservadas (incluye Supabase/correo/NODE_ENV/FRONTEND_URL/DISABLE_CRON).
- .env.local frontend ignorado: API ya http://localhost:3000; ninguna modificación.
- scripts/local/ añadido a.git/info/exclude; humo-inscripcion.cjs preparado (node
  --check sintaxis OK, NO ejecutado), marker wx impide repetir. Lee código del log,
  mantiene token en memoria, genera cédula mediante validador del proyecto, camino
  público bachiller; resultado/id guardado en humo-resultado.json al ejecutarse.
- npm run dev backend intentado: advirtió exactamente "Correo en modo consola: los
  mensajes NO se envían, se imprimen aquí" y crons desactivados. Falló listen EPERM:
  operation not permitted 0.0.0.0:3000. Proceso de vigilancia detenido con Ctrl+C.
- NO se inició frontend ni se borró.next; NO curl health/config/courses ni
  security:check-auth; NO humo ni solicitud creada; ninguna suite ni SQL ejecutado.
- Pendiente APROBACIÓN para ejecutar npm run dev en ambos repos fuera del sandbox,
  permitiendo escucha3000/3001. No cambiar dirección de escucha ni buscar atajos.
  Reanudar por arranque backend, frontend, curl, securitycheck, humo UNA vez; detener
  ambos al terminar. Si luego la red se bloquea, volver a detenerse y pedir permiso.
- Discrepancias estáticas observadas, SIN corregir: lib/api/solicitudes.ts legacy usa
  PATCH /admin/solicitudes/:id y /:id/documentos/:doc, inexistentes actualmente
  (decisión vigente POST/:id/decision; verificación POST/:id/verificaciones);
  consent legacy omite versionTerminos/aceptoTerminos; saveData legacy usa
  nombreCompleto y omite nombres/apellidos/nacionalidadTipo/tipoSangre;
  upload legacy envía tipo_documento en vez de subtipo; summary legacy espera
  documentosPorRevisar (ya no sale). types/solicitud.ts conserva documentos antiguos.
  Cliente vigente lib/api/inscripcion.ts coincide en rutas/payload público, salvo
  confirmarIdentidadPresencial tipado void frente a JSON real. Detalle admin añade
  vigente en verificaciones y studentId no declarados en types/inscripcion.ts.
- Cambios solo locales/excluidos y esta nota sin commit; no cambios de aplicación,
  migraciones055/056 ni tests. Sin commit nuevo por no haber archivos versionables.


## Diagnóstico de aprobación HTTP500 (2026-11-04)
- Usuario aportó POST/admin/solicitudes/:id/decision HTTP500 y JSON genérico
  ERROR_INTERNO; no SQLSTATE real. No repetir aprobaciones ni consultar/modificar
  SQL remoto. Backend activo pertenece a terminal del usuario, no se reinició.
- Defecto estático encontrado en052: INSERT enrollments.status(enum) recibe
  p_estado:text sin cast. Nueva delta057 preparada con cast explícito, scripts
  preflight/verificación catálogo ROLLBACK/rollback y runbook. NO edita052/055/056.
- Guarda de deriva: MD5 de cuerpo052 o057 conocido; aborta antes de cambios si el
  operador modificó el cuerpo manualmente. Datos/guarda055/ACL/firma intactos.
- Handler tenía retorno temprano que omitía logs de errores internos de inscripción;
  se usa logSafeError para conservar solo evento/tipo/código/estado, sin SQL ni PII.
- Commits453b0f5 (delta057/scripts/runbook) y2c7ced6 (log seguro).
  Typecheck/lint tocado/build backend OK. Ninguna suite ni SQL ejecutado.
- Causa concreta del intento del usuario sigue sin confirmar hasta disponer del
  código técnico. 057 queda MANUAL, no se da por aplicada ni por comprobada en F45.
  F46 de entorno sigue pendiente de autorización para servidores fuera del sandbox.

I17 CERRADA (2026-11-05): SQL06372de7a6 / backend162b1f7 / frontend a584c0e. Datos obligatorios/teléfono local/nivel vigente, progreso mínimo y todos los métodos verificados vigentes habilitan. Front público y admin acoplado/insignia. F45 final63/41/34/44, typecheck/lint/build ambos OK. Detalle y deuda en inscripcion-progreso-i17.md e inscripcion-pruebas-pendientes-i17.md, sin commit. Aplicación063 y revisión manual pendientes del operador. Sin SQL remoto/env/servidores/suites/push.
