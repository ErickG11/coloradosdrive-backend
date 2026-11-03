# Inscripción en línea — CC-01 / CC-02

## Aplicación manual

No ejecutar SQL desde la aplicación ni durante las pruebas HTTP. Verificar primero 001–036 (especialmente 026, 029, 035 y 036). Orden: 037_inscripcion_privacidad.sql → 038_solicitudes_aprobacion_atomica.sql → 039_solicitudes_eliminacion_atomica.sql. Cada número tiene preflight, verificación terminada en ROLLBACK y rollback en esta carpeta. Revisar resultados antes de aplicar; un archivo en git no acredita aplicación. 037 es repetible; no elimina ni deduce consentimientos para solicitudes antiguas.

038 agrega una RPC transaccional para checklist físico, estado y auditoría; Auth conserva compensación. 039 comparte la eliminación entre administración y cron. Ambas RPC son exclusivas de service_role. Bucket solicitudes-documentos privado; verificarlo en preflight. No cambiar políticas públicas para resolver errores de permisos.

## Configuración

Conservar las variables existentes. Nuevas: SOLICITUD_RETENCION_DIAS (entero positivo, 30 por defecto), PRIVACY_CONTACT_EMAIL (EMAIL_USER por defecto), TRUST_PROXY_HOPS (0–2, 1 para Railway con un proxy). PRIVACY_NOTICE_VERSION vive en src/config/privacy.ts; cambiarlo invalida aceptaciones anteriores para continuar. El aviso y la autorización de menores son borradores pendientes de revisión legal.

Límites por 15 minutos, en memoria y por proceso: envío 60/IP y 5/correo normalizado resumido SHA-256; confirmación 120/IP; datos/documentos/progreso 300/IP. Cinco errores por código independiente del límite IP. Permite redes compartidas sin dejar envíos ilimitados a un correo. Railway debe impedir acceso directo que salte el proxy; revisar saltos reales antes de producción. Si se replican procesos, sustituir el store por uno compartido.

## Probar sin correo

Solo para pruebas locales: `EMAIL_PROVIDER=console` sustituye los envíos por bloques
`[CORREO SIMULADO]` en la salida estándar del backend. No usa SMTP ni hace llamadas
de red para enviar correo. El resto del flujo conserva sus respuestas HTTP,
`correoEnviado: true` y la confirmación de entrega de los recordatorios.

Variables mínimas del backend (valores ficticios; usar un proyecto Supabase de
pruebas y sus claves locales, sin publicarlas):

```dotenv
NODE_ENV=development
EMAIL_PROVIDER=console
FRONTEND_URL=http://localhost:3001
SUPABASE_URL=https://proyecto-pruebas.supabase.co
SUPABASE_SERVICE_ROLE_KEY=clave-ficticia-service-role
SUPABASE_ANON_KEY=clave-ficticia-anon
SOLICITUD_TOKEN_SECRET=secreto-ficticio-local-de-al-menos-32-caracteres
```

No se requieren `EMAIL_USER`, `EMAIL_APP_PASSWORD` ni credenciales de correo de
ningún otro proveedor. El contacto del aviso usa `privacidad@example.invalid`
si tampoco se define `EMAIL_USER`; puede configurarse con `PRIVACY_CONTACT_EMAIL`.
El puerto predeterminado es 3000. Para una prueba manual sin tareas programadas,
añadir `DISABLE_CRON=true`; omitirlo para probar también los recordatorios.
Arrancar con `npm run dev` y reiniciar al cambiar las variables. También puede
usarse `EMAIL_PROVIDER=console DISABLE_CRON=true npm run dev` sin modificar `.env`.

Abrir `/inscripcion`, enviar código y copiar sus seis dígitos desde la terminal.
Tras aprobar la solicitud, la misma terminal muestra correo y contraseña temporal.
Los mensajes HTML sin alternativa de texto se convierten a texto conservando los
enlaces. Los adjuntos locales se listan por nombre y tamaño, sin imprimir su
contenido; las rutas remotas se rechazan sin descargarlas.

**Este modo es solo para pruebas.** Excepción T39 a la regla de logs sin datos
personales de T17: únicamente el proveedor console, fuera de producción, imprime
los destinatarios y cuerpos completos, incluidos códigos y contraseñas temporales.
No compartir ni almacenar esa salida con datos reales. Los demás logs y el
proveedor SMTP conservan su tratamiento existente. Al arrancar se muestra:
`Correo en modo consola: los mensajes NO se envían, se imprimen aquí`.
El backend rechaza el arranque con console si `NODE_ENV=production` o si existe
`RAILWAY_ENVIRONMENT`, incluso vacía. Sin `EMAIL_PROVIDER` se mantiene SMTP y se
exigen `EMAIL_USER` y `EMAIL_APP_PASSWORD`. En esta rama no existe `gmail_api` (T38).

## Contratos

Sin prefijo /api. Públicos sin Authorization; los pasos de solicitud usan Bearer del JWT temporal, nunca una sesión Supabase. JWT solo en memoria del navegador, una hora. Código de seis dígitos, 15 minutos, hash SHA-256; consumo/contador CAS. Reenviar no cambia created_at ni solicitada_at; curso inmutable desde solicitada_at.

- GET /public/courses → [{id,tipo,nombre,horasRequeridas}].
- GET /public/aviso-privacidad → {version,contactoDerechos,retencionDias}.
- POST /solicitudes/verificar-correo {correo,courseId} → {message}.
- POST /solicitudes/confirmar-codigo {correo,codigo} → {solicitudId,token}.
- GET /solicitudes/:id/progreso → {courseId,estado,correoVerificado,consentimientoVigente,datosGuardados,solicitadaAt,requiereRepresentante,representanteCompleto,documentos:[{tipo,estado,motivoRechazo}]}. El motivo permite corregir un documento rechazado; no se devuelven rutas ni enlaces.
- PUT /solicitudes/:id/consentimiento {versionAviso,aceptoTratamiento:true,declaraVeracidad:true} → {version}. Conserva fecha de la aceptación original de esa versión.
- PUT /solicitudes/:id/datos {cedula,nombreCompleto,telefono?,fechaNacimiento,representante?:{nombre,cedula,acepta:true}} → {solicitudId,token}. Exige consentimiento vigente, mínimo 15; representante obligatorio de 15 a 17. Primera escritura exitosa fija solicitada_at; un trigger conserva fecha y curso frente a concurrencia. Reintentos rechazados conservan ambas fechas originales.
- POST /solicitudes/:id/documentos multipart archivo + tipo_documento → {id,tipoDocumento,estado,uploadedAt}, 201. JPG/PNG/PDF, firma binaria y máximo 5 MiB. Datos/consentimiento obligatorios. No reemplaza aprobados. Documentos faltantes nunca bloquean la aprobación.
- GET /admin/solicitudes?estado=&q=&page=1&pageSize=20 → {items,total,page,pageSize}. Máximo 100 por página. Búsqueda literal acotada; items contienen checklist SIN URL, solicitadaAt y consentimiento:{version,aceptadoAt,representanteNombre,representanteCedula,representanteAcepta}. Solo solicitudes enviadas.
- GET /admin/solicitudes/:id/documentos/:docId/url → {url,expiresIn:300}. Registra acceso antes de firmar; no prefirmar toda la tabla. No registrar ni persistir enlaces.
- PATCH /admin/solicitudes/:id/documentos/:docId {estado:aprobado|rechazado,motivoRechazo?} → {id,estado}. Motivo obligatorio para rechazo; revisor y auditoría. Solo decide documentos en recibido: una decisión previa devuelve 409 DOCUMENTO_YA_REVISADO; una solicitud rechazada o reclamada devuelve 409 SOLICITUD_CERRADA; las aprobadas conservan revisión documental. La resubida de un rechazado vuelve a recibido y limpia motivo, fecha y revisor; no sobrescribe una aprobación ni otra resubida concurrente.
- PATCH /admin/solicitudes/:id {estado:aprobada|rechazada,motivoRechazo?} → {id,estado,studentId,correoEnviado,cohorteAsignada?}. Motivo obligatorio para rechazo. Aprobación exige datos/consentimiento; reclama reviewed_at antes de crear Auth. Copia nacimiento; crea documentos físicos pendientes (papeleta no_aplica desde 65). cohorteAsignada={cohortId:null|uuid,estado:activo|pendiente_cohorte}. Fallo SMTP no revierte; correoEnviado=false.
- DELETE /admin/solicitudes/:id → 204, solo no aprobadas. Storage primero; SQL/auditoría después. Si Storage falla, conserva rutas para reintentar. Aprobadas usan eliminación existente de Alumnos.
- GET /estudiantes/documentos-pendientes → {documentosPendientes:[tipo],fechaLimite:null|YYYY-MM-DD,diasRestantes:null|number,cohortePendiente:boolean}. Unión de pendientes de matrículas vigentes A/B; fecha más próxima si hay varias. Días civiles de Guayaquil, puede ser negativo.

Errores de solicitudes: {status:"error",message,code}, sin stack. Códigos principales: CODIGO_INVALIDO_O_VENCIDO, INTENTOS_AGOTADOS, LIMITE_PETICIONES, CORREO_YA_APROBADO, CURSO_NO_ENCONTRADO, CONSENTIMIENTO_REQUERIDO, AVISO_DESACTUALIZADO, EDAD_MINIMA, REPRESENTANTE_REQUERIDO, SOLICITUD_CERRADA, MOTIVO_REQUERIDO. También TOKEN_INVALIDO_O_VENCIDO, DATOS_INVALIDOS, CEDULA_ACTIVA y errores de proveedor seguros. No interpretar textos como estados.

## Cohortes y retención

Función única de margen en utils/cohortEligibility.ts: cierre menos día de solicitud en America/Guayaquil >=5, con cupo; ordenar por inicio de curso. No exige que matrícula haya abierto. Solicitud el 5: cierre el 9 no; el 10 y el 11 sí. Si se llena una candidata durante el INSERT, vuelve a consultar excluyéndola; sin candidata, pendiente_cohorte. El motor anterior se conserva para wizard manual y Alumnos; el preview público administrativo usa el nuevo. No se conservan horarios online porque esta etapa todavía no los captura.

Cron a las 03:00 America/Guayaquil: rechazadas N días desde revisión (created_at si falta); borradores a siete días desde created_at, con sus documentos. Nunca purga enviadas pendientes ni aprobadas. El reclamo revalida enviada_at para no borrar un envío concurrente. Auditoría conserva UUID/evento/actor/fecha, nunca nombres, cédulas, correos o motivos.

## Prueba manual futura (no ejecutada por el agente)

1. Aplicar preflight/migración/verificación por número, manualmente y con respaldo.
2. Usar un entorno autorizado de prueba: el proyecto compartido recibe escrituras y correos reales.
3. Con cron desactivado localmente, abrir /inscripcion desde Tipo A y B. Verificar selección y curso inexistente, correo inválido, envío, código con cero inicial, vencido e intentos agotados.
4. Reenviar y recargar: token desaparece; re-verificar permite consultar progreso. Curso ya fijado conserva original.
5. Revisar /privacidad: borrador, versión, contacto y retención. Probar casillas ausentes y versión antigua directamente contra API.
6. Probar 14 años (rechazado), 15–17 sin representante (rechazado), representante válido y adulto. Calendario permite seleccionar fechas; error aparece junto al campo.
7. Subir JPG/PNG/PDF, >5 MiB, contenido con MIME falsificado, reemplazar recibido/rechazado y probar aprobado. Intentar enviar sin los obligatorios (bloqueado); con cédula y título, enviar conservando opcionales pendientes.
8. Admin: paginar/buscar/filtrar; abrir documento solo al pulsar Ver; comprobar auditoría y enlace vencido; aprobar/rechazar con motivo. Dos aprobaciones simultáneas deben crear una sola cuenta.
9. Comprobar cohortes con solicitud el 5/cierre el 9, 10 y 11; matrícula aún no abierta; sin cupo; sin candidatas.
10. Revisar credenciales, cambio obligatorio de contraseña, nacimiento y checklist físico. Marcar físicos desde matrícula existente; inicio alumno muestra pendientes y plazo.
11. Eliminar una no aprobada (cancelar y confirmar); revisar Storage y auditoría. Probar fallo de Storage y reintento. No probar purga sobre datos reales sin autorización explícita.
12. Pantallas nuevas en 375/768/1280, claro/oscuro, teclado, foco, lector de pantalla y reducción de movimiento.

## Recuperación y rollback

Retirar primero frontend dependiente; revertir versión backend antes de retirar SQL. Rollback SQL inverso: 039 → 038 → 037. Exportar consentimientos antes de 037; se conserva auditoría. El borrado de datos/Storage no se recupera con rollback; requiere respaldo. Si un proceso muere tras reclamar una aprobación, no liberar a ciegas: revisar Auth, users, enrollments, solicitud y auditoría; resolver coherentemente antes de reintentar. Una respuesta RPC perdida se verifica antes de compensar; si tampoco se puede consultar, devuelve APROBACION_NO_CONFIRMADA y conserva el reclamo para revisión.

No se instalaron dependencias ni se ejecutaron scripts test:*-db, SQL remoto o servidores. La validación SQL de estos archivos queda pendiente de aplicación manual; Jest simula proveedores.

## Evolución T43–T54: envío explícito y documentos del alumno

Aplicar **manualmente 040 y después 041**, con los preflight, verificaciones con
ROLLBACK y rollback del mismo número. No se aplicaron desde el agente. Desplegar
backend y frontend juntos después de las migraciones. 040 agrega `enviada_at`,
backfill, índices parciales, la vista privada `solicitudes_admin` y RPC exclusivas
de service_role. 041 amplía el constraint de notificaciones y agrega la revisión
atómica de documento + auditoría + notificación de bandeja (sin correo). RLS y
el bucket siguen privados; no se agregan permisos a anon ni authenticated.

El backfill solo marca registros con datos guardados y ambos obligatorios; usa
el mayor uploaded_at de cédula y título. Antes de desplegar, revisar expedientes
legacy decididos sin estos documentos: no entran en el nuevo listado hasta que
la escuela resuelva su documentación. El rollback de 040 pierde las fechas de
envío; exportarlas primero. El índice antiguo de cédulas vuelve a ser más
restrictivo: resolver borradores duplicados antes de revertir. El rollback de
041 se detiene si existen notificaciones nuevas, para no eliminarlas en silencio.

Estados públicos derivados: `borrador` (enviada_at nula), `enviada`
(pendiente_revision con enviada_at), `aprobada`, `rechazada`. Guardar datos o subir
archivos no envía la solicitud. La cédula y el título son obligatorios para enviar;
rechazado cuenta como presente. Papeleta y tipo de sangre son opcionales por ahora.
Un envío validado es idempotente y conserva enviada_at. Los datos y consentimiento
se congelan tras enviar. Los borradores se purgan a los siete días con sus archivos,
aunque tengan documentos; las enviadas pendientes no se purgan. Se conserva la
retención configurada de rechazadas.

### Contratos nuevos y modificados

- POST `/solicitudes/verificar-correo`: mismo 200 y mensaje genérico para todos los
  correos válidos; no revela solicitud ni cuenta, tampoco un fallo SMTP. Un correo
  con cuenta sin solicitud no crea registro ni recibe código utilizable. Una
  solicitud existente (incluida aprobada vinculada a su alumno) permite verificar
  para consultar estado; nunca crea otra ni cambia curso o datos.
- GET `/solicitudes/:id/progreso`, solo tras verificar: estado derivado, enviadaAt
  y motivoRechazo únicamente si rechazada, además de los campos previos.
- POST `/solicitudes/:id/enviar`, token temporal: `{id,estado,enviadaAt}`. Valida
  correo, consentimiento vigente, datos, representante y documentos obligatorios.
  Falta de obligatorios: 400 SOLICITUD_INCOMPLETA, `faltantes` y
  `detalles:{faltantes:[cedula|titulo_bachiller]}`. El dato sensible no aparece en logs.
- PUT datos/consentimiento después del envío: 409 SOLICITUD_ENVIADA. Cédula duplicada
  en solicitud enviada/aprobada o usuario: 409 CEDULA_YA_REGISTRADA. Campos inválidos
  incluyen código y field. Nombre de 5–100 caracteres y dos palabras; teléfono local
  09 o convencional 02–07, normalizando +593; edad entre 15 y 100, representante
  distinto, correo máximo 254, código de seis dígitos y archivos no vacíos hasta 5 MiB.
- GET `/admin/solicitudes`: solo enviadas; pendientes primero por enviada_at asc,
  decididas por reviewed_at desc, desempate id asc. Filtro adicional
  con_documentos_por_revisar; filas agregan enviadaAt y documentosPorRevisar.
  Ninguna operación administrativa permite decidir ni ver un borrador.
- GET `/admin/solicitudes/resumen`: `{pendientes,documentosPorRevisar}`. Los conteos
  usan índices y no descargan expedientes. El sidebar consulta cada 30 segundos
  visible, al recuperar foco y tras decisiones/eliminaciones. El aviso no aparece
  en la primera carga, solo al crecer el número.
- PATCH documento: permite pendientes o aprobadas, nunca rechazadas. El estado del
  documento debe ser recibido; decisión + auditoría + notificación son atómicas.
  No se puede volver a decidir; reemplazar uno rechazado reinicia la revisión.
- GET `/estudiantes/documentos`: sesión de alumno activo con contraseña actualizada;
  `{documentos:[{tipo,estado,motivoRechazo,uploadedAt,reviewedAt,obligatorio,exento,
  estadoFisico}],puedeSubir}`. Estado digital: sin_subir/en_revision/aprobado/rechazado.
  POST en esa ruta recibe archivo + tipo_documento, máximo 30 subidas/15 min/usuario,
  usando el mismo helper y Storage privado del postulante. Aprobado bloquea con
  DOCUMENTO_YA_APROBADO. No se ofrece enlace de descarga al alumno: no hay endpoint
  de firmado propio autorizado en este alcance; no se reutilizan enlaces del admin.

Mapeo físico mínimo uno a uno: cedula→cedula, papeleta_votacion→papeleta_votacion,
tipo_sangre→tipo_sangre, titulo_bachiller→titulo_bachiller. No hay desajustes de nombres.
Se muestra pendiente si alguna matrícula activa/pendiente de cohorte lo requiere;
sin filas, Sin registro; todos exentos, No aplica. No se marca entrega física al
aprobar un archivo digital. La aprobación conserva estados digitales e inicializa
el checklist físico pendiente (exención de papeleta desde 65). Un alumno de matrícula
manual sin solicitud vinculada puede consultar su checklist, pero no subir archivos:
no se crea un expediente implícito ni se vincula por cédula.

### Guion manual adicional (después de aplicar 040/041)

1. Verificar dos veces un mismo correo en borrador, enviada, aprobada y rechazada;
   antes del código no debe divulgarse el estado. Probar cuenta sin solicitud.
2. Intentar enviar sin cédula, sin título y sin ambos: mensajes específicos y foco
   al resumen; ningún POST si faltan en cliente. Repetir contra API: 400 con faltantes.
3. Enviar ambos; repetir POST y comprobar misma fecha. Cambiar datos/consentimiento:
   409. Subir opcionales después del envío sin reabrir ni duplicar solicitud.
4. Probar nombres de una palabra, cédula repetida, representante igual, cumpleaños
   de 15/100 años, fecha futura, teléfonos +593/09/convencional y PDF vacío/falso/>5 MiB.
5. Admin: borradores ausentes, orden/paginación estable, resumen, filtro documental,
   badge obligatorios y fecha. Decidir borrador debe devolver 409. Abrir otra pestaña,
   revisar documento y comprobar conflicto/actualización en la primera.
6. Aprobar, entrar como alumno tras cambiar contraseña y consultar Mis documentos;
   revisar archivo aprobado/rechazado, reemplazar solo no aprobados. Confirmar que
   otra cuenta y la cuenta inactiva no acceden; comprobar exención desde 65.
7. Admin revisa un reemplazo de solicitud aprobada: notificación única para el alumno,
   con motivo si corresponde. Checklist físico sigue independiente.
8. Ver contador en cero, 1 y más de 99; carga inicial sin aviso, aumento con aviso,
   pestaña oculta sin polling, foco y decisión refrescan. Revisar ambos temas a
   375/768/1280 px, navegación por teclado y errores junto al campo.
