# Deuda de pruebas: fase final bajo petición explícita

Método autorizado: no escribir/editar/ejecutar pruebas hasta que lo pida el usuario.
Las suites existentes se conservan intactas; sus resultados anteriores no validan
los cambios nuevos. F23 y toda ejecución quedan para la fase final. F43 tiene una
suspensión independiente y requiere también autorización expresa.

## F10 — consentimiento y términos

- GET aviso: versiones, todos los bloques de texto plano, salud/tipo de sangre,
  contacto, retención configurable, aviso BORRADOR/en revisión legal, no-store.
  Configuración: versiones vacías/default, caracteres inválidos/>100; reembolso
  >2000, NFC/controles/HTML presentado como texto; incremento de versión al cambiar texto.
- PUT consentimiento con las tres casillas true y versiones vigentes en borrador y
  devuelta (enviada_at previa no debe bloquear); conserva respuesta y fecha original.
  Cambiar solo TERMS_VERSION crea nueva evidencia sin borrar la anterior.
- Casillas false/ausentes/string/1, versión anterior de aviso/términos, cuerpo null/array,
  campos extra (estado/id/aceptadoAt), representanteAcepta no booleano: rechazo estable
  sin escrituras. Filas legacy sin términos nunca satisfacen currentConsent.
- Permisos: sin token, token vencido/de otra solicitud, scope estado, correo no verificado,
  enviada/aprobada/rechazada; acceso SQL anon/authenticated denegado y service_role permitido.
- Concurrencia: doble aceptación conserva una fila y una primera fecha; aceptar contra
  enviar/devolver/decidir se serializa por solicitud; repetir autorización del representante
  no revoca true ni duplica auditoría. Datos de representante mantienen CHECK original.
- Fallos DB/RPC sin datos, errores no filtrados al cliente ni PII en logs/auditoría;
  progreso/requireConsent requieren ambas versiones y las tres casillas.
- Migración repetida, preflight sin objetos falla sin cambios, verificación ROLLBACK,
  rollback repetido sin pérdida; rollback con varios términos aborta sin borrar evidencia.

## F11 — datos personales, edad, nivel y unicidad

- PUT real con nombres/apellidos de 2 y60 caracteres, NFC/tildes/ñ/apóstrofe/guion,
  nombreCompleto derivado y nunca aceptado del cliente; cédula algoritmo único
  (provincias01–24/30, tercer dígito<6, ceros iniciales/verificador), fecha civil.
- Teléfono omitido/vacío limpia, celular/convencional/+593 válidos; booleano/null,
  espacios internos, número incompleto o extranjero inválido. Reenvío sin nivel
  conserva el anterior; cinco niveles permitidos; menos_de_decimo y valores arbitrarios
  no guardan. Extranjero sin cédula deriva a contacto sin escribir.
- Nombres/control/RTL/HTML/extralargos, apellidos faltantes, fecha imposible/futura,
  cumpleaños hoy/mañana, bisiesto, límites99/100/101 años y huso Guayaquil; tipo sangre
  no_sabe válido y resto catálogo; JSON extra/anidado/id/estado/courseId/nombreCompleto
  o coerciones rechazadas. No ensayar mediante HTTP datos reales.
- Curso mínimo18 bloquea menor; curso mínimo15 permite15–17 con representante:
  nombre completo, cédula válida y distinta, acepta:true. Falta/false/string y adulto
  con representante fallan. Cambio concurrente de mínimo del curso se revalida en SQL.
- Ambas versiones de consentimiento y tres aceptaciones obligatorias; menores guardan
  datos/autoriza_tratamiento/representante_acepta sin romper CHECK de037. Progreso
  devuelve representante propio para reanudar, sin notas o rutas y con no-store.
- Solo borrador/devuelta editables; devuelta conserva fecha del primer envío. Sin
  sesión, expirado, otra solicitud, scope estado, no verificado, enviada/aprobada/
  rechazada fallan antes de escribir. No se cambia correo/curso/id/fechas originales.
- Duplicado contra users y solicitudes enviada/devuelta/aprobada, carrera23505:
  mismo DATOS_NO_REGISTRADOS/mensaje sin datos ni nombre de índice. Borradores no
  reservan cédula (diseño042); F13 debe dirimir envíos concurrentes. Considerar creación
  manual de alumno entre preconsulta y envío/aprobación, sin cambiar wizard manual.
- Doble guardado idéntico no duplica auditoría ni avanza datos_actualizados_at;
  dos cuerpos distintos se guardan completos en orden, nunca mezclados. Guardar
  contra enviar/devolver/decidir: misma fila bloqueada; datos/representante atómicos.
  Cambio de nivel limpia pending_por_cupo; F12 valida certificado incompatible.
- Cambiar datos o representante invalida frescura de verificaciones en F14/F15.
  Fallo de actualización del consentimiento/auditoría revierte también datos; DB
  indisponible/RPC sin datos responde seguro, sin logs personales.
- SQL047 repetición, objeto/índice/curso faltante, permisos anon/authenticated/service_role,
  verificación ROLLBACK y rollback preservando datos. Carrera real requiere PostgreSQL
  multiconexión en la fase final, no inferirla de ejecución embebida serial.



## F44-a/b (sin excepción de pruebas)

- F44-a: cuatro códigos y SQLSTATE460–462 en cada ruta pública y con token de
  solicitud devuelven exactamente HTTP409/DATOS_NO_REGISTRADOS/mensaje único,
  sin campo/detalles/faltantes/stack en ningún entorno. Admin real en /admin conserva
  códigos; sin sesión, alumno/instructor y cabecera falsa nunca obtienen detalles.
- F44-b: smtp/gmail_api/console con Nodemailer10.3.1, createTransport con objeto,
  MailComposer compile/build/Bcc, destinatarios simples/direcciones/listas anidadas
  acotadas en console, timeout y401 de API; sin leer .env ni hacer envíos reales.
  Comprobar bloqueo de auditoría alta en GitHub/Jenkins en la fase final autorizada.
- F45 excepcional ya ejecutada:54 migraciones/32 preflights/25 verificaciones/35
  rollbacks; no se ejecutaron otras suites ni se modificaron sus casos existentes.


## F44-c — recuperación (fase final, no ejecutada salvo SQL055)
- Matar proceso antes/después de createUser y de finalizar; confirmar que cron libera
  reviewed_by/at solo para claim exacto y compensa exclusivamente UUID/marcas propios.
- Auth404 vs500/timeout: solo ausencia confirmada permite cierre; borrar y releer404.
- Respuesta de creación perdida y creación tardía después de compensación; revisita
  tombstone y elimina Auth tardío sin tocar el nuevo intento ni perfil aprobado.
- Dos cron y finalizador concurrentes: lease único, finalizador antiguo aborta sin
  perfil/matrícula parcial; recuperación no elimina cuenta completada/con perfil.
- TTL1/10/1440 y valores inválidos; cron zona/intervalo, DISABLE_CRON, lotes/prioridad.
- Legacy sin cuenta se libera; con cuenta se conserva y audita una vez para revisión.
- Errores de DB/SMTP, cuenta ajena/rol distinto/marcas distintas: no liberar ni borrar;
  no datos personales en logs; respuesta exitosa normal/correo de cortesía intactos.


## F44-d — override administrativo (fase final)
- HTTP401/403 por anon/alumno/instructor/admin inactivo, MFA requerido; p_actor
  siempre de sesión, body con actor/campos extra rechazado. UUID/JSON inválido400.
- Motivo normalizado9/10/300/301 caracteres Unicode, vacío/array/null/control/RTL;
  no motivo/body/documentos en logs, ni error técnico o SQL hacia cliente.
- Selección misma matrícula reciente que GET; sin matrícula/manual409; sin práctica,
  distinta cohorte/alumno, franja cancelada o fin+48h exacto no habilitan override.
- Instructor/admin simultáneos y dos admins: primera marca gana, un solo motivo/audit;
  no cambia certificado_original_visto. Fallo de insert auditoría revierte matrícula.
- Perfil eliminado/en eliminación, reintentos tras respuesta perdida, admin desactivado
  entre middleware y SQL, bloqueo DB/timeouts503 y refrescar ficha antes de repetir.
- SQL056 ya ensayó fixtures/roles/ventana/manual/idempotencia con ROLLBACK en F45;
  no equivale a red real ni carrera multiconexión.


## F44-e — mensajes y UI (fase final, no ejecutados)
- En cada paso real de /inscripcion, simular los cuatro códigos admin con texto,
  field y detalles sensibles: solo mensaje genérico único, sin campo señalado.
- Panel admin muestra literalmente los4 mensajes acordados al aprobar/verificar;
  no exposición por rol ni textos de backend desconocidos a postulante.
- Ficha autónoma y drawer: botón solo origen solicitud/no confirmada; sin campo
  en backend antiguo oculto. Modal con Modal/Input/Button existentes, contador por
  puntos de código/NFC, motivo vacío/9/10/300/301, RTL/controles/espacios/emoji.
- Doble clic/Enter concurrente envía una sola vez, cierre bloqueado mientras guarda;
  Escape/foco/cancelación/reseteo, UUID al cambiar alumno, guardas del drawer.
- 200 transicion:true/false: toast verde, GET actualizado y botón oculto; fallo GET
  muestra recarga. 400/401/403/MFA/404/409 en español por código, sin datos técnicos.
- Timeout/desconexión/503: no repetir automáticamente, pedir recargar antes de
  permitir otra confirmación; conserva motivo solo en memoria del modal.
- Layout375/768/1280 claro/oscuro, teclado, contador/descripciones con IDs únicos.
- Deuda anterior confirmada por tsc global:9 errores en DocumentReviewAfterApproval,
  DocumentViewer, ReviewActions y SolicitudDetail (tests), no tocados por mandato.
  Corregir en fase final; no confundir typecheck de aplicación con global completo.


## Error500 al aprobar / delta057 — pendiente fase final autorizada
- Reproducir el intento reportado solo tras revisar estado/reclamo/Auth; el JSON
  ERROR_INTERNO no identifica la causa. Log seguro debe permitir ver SQLSTATE42804
  si el fallo era la conversión text→enum, u otro código si hay una causa adicional.
- Aplicar057 en arnés autorizado y comprobar ambas ramas: activo con cohorte y
  pendiente_cohorte sin cohorte, perfil/matrícula/checklist/auditoría atómicos.
- Conserva guarda055, UUID Auth=UUID intención, firma RPC/ACL y SECURITY INVOKER;
  rollback idéntico a052, sin modificar cuentas, fechas ni estados existentes.
- Error de datos, cupo concurrente, RPC perdido y Auth fallido: compensación segura
  como antes, sin duplicar cuenta/perfil/matrícula, no correo antes de confirmar.
- Preflight/migración/rollback abortan ante cuerpo distinto del revisado; reaplicar
  permitido. SQL057 NO ejecutado, ni local ni remoto. No se añadieron suites.
- Handler registra solo evento/tipo/código/estado para PostgREST/Auth sin AppError;
  respuestas públicas genéricas sin stack y sin mensajes/SQL/body/PII en logs.
